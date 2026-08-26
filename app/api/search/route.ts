import { searchParts } from "../../../db/catalog-queries";

const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit")) || 8, MAX_LIMIT);
  const catalog = url.searchParams.get("catalog") ?? undefined;

  if (query.length < 2) return Response.json({ query, total: 0, results: [] });

  try {
    const found = await searchParts(query, limit, catalog ? { catalog } : undefined);
    return Response.json({ query, ...found });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const missingTable = message.includes("no such table");
    return Response.json(
      {
        error: missingTable
          ? "The catalog tables are missing. Apply drizzle/ and run scripts/seed_d1.mjs."
          : message,
      },
      { status: missingTable ? 503 : 500 },
    );
  }
}
