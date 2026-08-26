/**
 * Loads public/parts-data.json into the D1 catalog tables.
 *
 * Emits SQL on stdout so it can be piped into `wrangler d1 execute`, which is the
 * only way to reach both the local Miniflare database and the deployed one.
 *
 *   node scripts/seed_d1.mjs > /tmp/seed.sql
 *   npx wrangler d1 execute site-creator-d1 --local --file /tmp/seed.sql
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(resolve(root, "public/parts-data.json"), "utf8"));

let hebrew = {};
try {
  hebrew = JSON.parse(readFileSync(resolve(root, "public/hebrew-descriptions.json"), "utf8"));
} catch {
  hebrew = {};
}

const q = (value) => {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
};
const looseOf = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

const out = [];
const emit = (line) => out.push(line);

emit("PRAGMA defer_foreign_keys = true;");
for (const table of ["occurrences", "parts", "groups", "catalog_vins", "catalogs", "meta"]) {
  emit(`DELETE FROM ${table};`);
}

/** D1 rejects very large statements, so rows go out in bounded batches. */
const insertBatched = (table, columns, rows, batchSize = 200) => {
  for (let start = 0; start < rows.length; start += batchSize) {
    const chunk = rows.slice(start, start + batchSize);
    const values = chunk.map((row) => `(${row.map(q).join(",")})`).join(",");
    emit(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values};`);
  }
};

insertBatched(
  "catalogs",
  ["catalog", "model", "year", "engine", "vehicle_type", "part_count", "vin_count"],
  data.catalogs.map((item) => [
    item.catalog, item.model ?? "", item.year ?? "", item.engine ?? "",
    item.vehicleType ?? "", item.parts ?? 0, item.vins ?? 0,
  ]),
);

insertBatched(
  "catalog_vins",
  ["vin", "catalog"],
  data.catalogs.flatMap((item) => (item.vinNumbers ?? []).map((vin) => [vin, item.catalog])),
);

insertBatched(
  "groups",
  ["id", "catalog", "code", "title", "figure"],
  Object.entries(data.groups).map(([id, group]) => [
    id, group.catalog ?? "", group.code ?? "", group.title ?? "", group.figure ?? "",
  ]),
);

insertBatched(
  "parts",
  ["part_number", "loose", "description", "description_chinese", "description_hebrew",
   "haystack", "occurrence_count"],
  data.parts.map((part) => {
    const he = hebrew[part.partNumber] ?? part.descriptionHebrew ?? null;
    const haystack = [
      part.partNumber, part.description, part.descriptionChinese, he ?? "",
      ...(part.assemblies ?? []),
    ].join(" ").toLowerCase();
    return [
      part.partNumber, looseOf(part.partNumber), part.description ?? "",
      part.descriptionChinese ?? "", he, haystack, (part.occurrences ?? []).length,
    ];
  }),
);

insertBatched(
  "occurrences",
  ["part_number", "group_id", "catalog", "assembly", "assembly_code", "description",
   "description_chinese", "quantity", "unit", "notes", "position", "model", "year",
   "engine", "vehicle_type", "representative_vin", "vin_count"],
  data.parts.flatMap((part) =>
    (part.occurrences ?? []).map((item) => [
      part.partNumber, item.groupId ?? "", item.catalog ?? "", item.assembly ?? "",
      item.assemblyCode ?? "", item.description ?? "", item.descriptionChinese ?? "",
      item.quantity ?? "", item.unit ?? "", item.notes ?? "", item.position ?? "",
      item.model ?? "", item.year ?? "", item.engine ?? "", item.vehicleType ?? "",
      item.representativeVin ?? "", item.vinCount ?? 0,
    ]),
  ),
);

insertBatched("meta", ["key", "value"], [
  ["generated", data.generated ?? ""],
  ["catalogCount", String(data.catalogCount ?? data.catalogs.length)],
  ["figureCount", String(data.figureCount ?? 0)],
  ["occurrenceCount", String(data.occurrenceCount ?? 0)],
  ["uniqueParts", String(data.uniqueParts ?? data.parts.length)],
]);

process.stdout.write(out.join("\n") + "\n");
