/**
 * Fills public/hebrew-descriptions.json using the Message Batches API.
 *
 * The catalog descriptions are English and Chinese. Search quality in Hebrew
 * depends on this file, and today it covers a fraction of the parts. Translation
 * runs once per import, offline - never in the search path - so every user gets
 * better Hebrew matching at no per-query cost. Batches run at half price.
 *
 *   node scripts/translate_descriptions.mjs --dry-run
 *   node scripts/translate_descriptions.mjs --limit 500
 *   node scripts/translate_descriptions.mjs
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = "claude-opus-5";
const POLL_INTERVAL_MS = 30_000;

const SYSTEM = `אתה מתרגם שמות של חלפי אוטובוס למונח שבו משתמש מחסנאי או מכונאי בישראל.

- החזר אך ורק את המונח בעברית. בלי הסבר, בלי מרכאות, בלי מק״ט.
- השתמש במונח המקצועי המקובל בשטח, לא בתרגום מילולי: "wiper rod" הוא "זרוע מגב",
  "brake lining" הוא "רפידת בלם".
- שמור צד ומיקום אם הם מופיעים: LH הוא "שמאל", RH הוא "ימין", front הוא "קדמי".
- שמות מותג, דגם וקודים טכניים נשארים כפי שהם באנגלית (Cummins, ZF, M8×30).
- אם התיאור חסר משמעות או שאי אפשר לתרגם, החזר בדיוק: —`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = resolve(root, "public/parts-data.json");
const hebrewPath = resolve(root, "public/hebrew-descriptions.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;

const data = JSON.parse(readFileSync(dataPath, "utf8"));
let hebrew = {};
try {
  hebrew = JSON.parse(readFileSync(hebrewPath, "utf8"));
} catch {
  hebrew = {};
}

/** A description worth translating: some Latin or Chinese text, and no Hebrew yet. */
const translatable = (part) => {
  if (hebrew[part.partNumber]) return false;
  const text = `${part.description ?? ""} ${part.descriptionChinese ?? ""}`.trim();
  if (!text) return false;
  return /[A-Za-z一-鿿]/.test(text);
};

const pending = data.parts.filter(translatable).slice(0, limit);

console.log(`parts ${data.parts.length} · already translated ${Object.keys(hebrew).length} · to translate ${pending.length}`);
if (!pending.length) {
  console.log("Nothing to do.");
  process.exit(0);
}

// custom_id allows only [A-Za-z0-9_-], and part numbers carry dots and slashes,
// so requests are keyed by index and mapped back after the batch ends.
const keyed = pending.map((part, index) => ({ id: `p${index}`, part }));
const byId = new Map(keyed.map(({ id, part }) => [id, part]));

const promptFor = (part) => {
  const lines = [
    `תיאור באנגלית: ${part.description || "—"}`,
    `תיאור בסינית: ${part.descriptionChinese || "—"}`,
  ];
  const assembly = (part.assemblies ?? [])[0];
  if (assembly) lines.push(`המכלול שבו החלק מופיע: ${assembly}`);
  lines.push("", "המונח בעברית:");
  return lines.join("\n");
};

if (dryRun) {
  console.log("\nDRY RUN - no batch submitted. First three requests:\n");
  for (const { id, part } of keyed.slice(0, 3)) {
    console.log(`--- ${id} (${part.partNumber}) ---`);
    console.log(promptFor(part));
    console.log();
  }
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const client = new Anthropic();

const batch = await client.messages.batches.create({
  requests: keyed.map(({ id, part }) => ({
    custom_id: id,
    params: {
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: "user", content: promptFor(part) }],
    },
  })),
});
console.log(`batch ${batch.id} submitted · ${keyed.length} requests`);

let current = batch;
while (current.processing_status !== "ended") {
  await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  current = await client.messages.batches.retrieve(batch.id);
  const counts = current.request_counts;
  console.log(`  ${current.processing_status} · succeeded ${counts.succeeded} · errored ${counts.errored} · processing ${counts.processing}`);
}

let added = 0;
let skipped = 0;
let failed = 0;
for await (const result of await client.messages.batches.results(batch.id)) {
  const part = byId.get(result.custom_id);
  if (!part) continue;
  if (result.result.type !== "succeeded") {
    failed += 1;
    continue;
  }
  const text = result.result.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  // The model returns an em dash when a description cannot be translated.
  if (!text || text === "—" || !/[֐-׿]/.test(text)) {
    skipped += 1;
    continue;
  }
  hebrew[part.partNumber] = text;
  added += 1;
}

writeFileSync(hebrewPath, `${JSON.stringify(hebrew, null, 2)}\n`, "utf8");
console.log(`\nadded ${added} · not translatable ${skipped} · failed ${failed}`);
console.log(`hebrew-descriptions.json now covers ${Object.keys(hebrew).length} of ${data.parts.length} parts`);
console.log("Re-run scripts/seed_d1.mjs so the search index picks the new descriptions up.");
