import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { getPart, listAssembly, partsForVin, searchParts } from "../../../db/catalog-queries";

const MODEL = "claude-opus-5";

const SYSTEM_HE = `אתה עוזר לקטלוג החלפים של Zhongtong, ועובד מול מוסכאים ומחסנאים בישראל.

כללי ברזל:
- ענה אך ורק לפי מה שהכלים החזירו. אל תמציא מק״ט, תיאור, כמות או מיקום בשרטוט.
- אם הכלים לא החזירו התאמה, אמור זאת במפורש והצע ניסוח אחר או שאל שאלת הבהרה.
- מק״ט תמיד בצורתו המלאה מהקטלוג, כולל מקפים.
- כשיש כמה התאמות, הצג את המובילות ואמור מה מבדיל ביניהן (דגם, שנה, צד, מיקום).
- תשובות קצרות ומעשיות. המשתמש עומד ליד מדף, לא קורא מאמר.
- ענה בעברית.

התיאורים בקטלוג באנגלית ובסינית. מונחי מוסך בעברית — "מגב", "רפידות", "זרוע" —
תרגם בעצמך למונח הקטלוגי לפני החיפוש, ונסה כמה ניסוחים אם הראשון לא החזיר כלום.`;

const SYSTEM_EN = `You help mechanics and parts staff use the Zhongtong parts catalog.

Rules:
- Answer only from what the tools returned. Never invent a part number, description, quantity or diagram position.
- If the tools found nothing, say so and suggest another wording or ask a clarifying question.
- Always give part numbers in their full catalog form, including hyphens.
- When several parts match, show the leading ones and say what separates them (model, year, side, position).
- Keep answers short and practical. The user is standing at a shelf.
- Answer in English.`;

type Body = {
  messages?: { role: "user" | "assistant"; content: string }[];
  language?: "he" | "en";
  vin?: string;
  catalog?: string;
};

const tools = [
  betaTool({
    name: "search_parts",
    description:
      "Search the catalog by part number or by description. Part numbers match in any " +
      "spelling: 37478600012, 3747 86 00012 and 3747-86-00012 all find the same part. " +
      "Returns ranked matches with the number of assemblies each part appears in.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part number or description text" },
        limit: { type: "integer", description: "How many matches to return (default 8, max 25)" },
        catalog: { type: "string", description: "Restrict the search to one catalog" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (input) => {
      const { query, limit, catalog } = input as { query: string; limit?: number; catalog?: string };
      const found = await searchParts(query, Math.min(limit ?? 8, 25), catalog ? { catalog } : undefined);
      return JSON.stringify(found);
    },
  }),
  betaTool({
    name: "get_part",
    description:
      "Full record for one part: descriptions, and every assembly and catalog it appears " +
      "in with its diagram position and quantity. Use this before answering about a specific part.",
    inputSchema: {
      type: "object",
      properties: { part_number: { type: "string", description: "The part number, any spelling" } },
      required: ["part_number"],
      additionalProperties: false,
    },
    run: async (input) => {
      const { part_number: partNumber } = input as { part_number: string };
      const part = await getPart(partNumber);
      return JSON.stringify(part ?? { error: "Part not found" });
    },
  }),
  betaTool({
    name: "list_assembly",
    description:
      "Every part drawn in one assembly, in diagram-position order. Use it to answer " +
      "'what else is on this drawing' or to find a neighbouring part.",
    inputSchema: {
      type: "object",
      properties: { group_id: { type: "string", description: "Assembly id, e.g. g1139" } },
      required: ["group_id"],
      additionalProperties: false,
    },
    run: async (input) => {
      const { group_id: groupId } = input as { group_id: string };
      const assembly = await listAssembly(groupId);
      return JSON.stringify(assembly ?? { error: "Assembly not found" });
    },
  }),
  betaTool({
    name: "parts_for_vin",
    description:
      "Resolve a 17-character chassis number to its catalog, and optionally search inside " +
      "that catalog only. Use this whenever the user gives a VIN, so answers stay specific to their bus.",
    inputSchema: {
      type: "object",
      properties: {
        vin: { type: "string", description: "17-character chassis number" },
        query: { type: "string", description: "Optional search inside that catalog" },
      },
      required: ["vin"],
      additionalProperties: false,
    },
    run: async (input) => {
      const { vin, query } = input as { vin: string; query?: string };
      const result = await partsForVin(vin, query);
      return JSON.stringify(result ?? { error: "VIN not found in any catalog" });
    },
  }),
];

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(request: Request) {
  const apiKey = globalThis.__ZT_SITE_ENV__?.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "The catalog assistant is not configured. Set the ANTHROPIC_API_KEY secret on the worker." },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const history = (body.messages ?? [])
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .slice(-12);
  if (!history.length) {
    return Response.json({ error: "No messages supplied" }, { status: 400 });
  }

  const he = body.language !== "en";
  const context: string[] = [];
  if (body.vin) context.push(`The user is looking at chassis number ${body.vin}.`);
  if (body.catalog) context.push(`The user is inside the catalog "${body.catalog}".`);

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sse(event, data)));
      try {
        const runner = client.beta.messages.toolRunner({
          model: MODEL,
          max_tokens: 8000,
          thinking: { type: "adaptive" },
          system: (he ? SYSTEM_HE : SYSTEM_EN) + (context.length ? `\n\n${context.join("\n")}` : ""),
          tools,
          messages: history.map((message) => ({ role: message.role, content: message.content })),
          stream: true,
        });

        for await (const messageStream of runner) {
          for await (const event of messageStream) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              send("tool", { name: event.content_block.name });
            }
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send("text", { text: event.delta.text });
            }
          }
        }

        const final = await runner.done();
        send("done", { stopReason: final.stop_reason ?? null });
      } catch (error) {
        send("error", { error: error instanceof Error ? error.message : "Unexpected error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
