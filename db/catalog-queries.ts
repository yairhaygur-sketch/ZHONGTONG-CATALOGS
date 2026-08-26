import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./index";

export const looseOf = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const tokensOf = (value: string) =>
  value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);

export type SearchHit = {
  partNumber: string;
  description: string;
  descriptionHebrew: string | null;
  occurrenceCount: number;
  via: "part" | "description";
  models: string[];
};

export type PartOccurrence = {
  groupId: string;
  catalog: string;
  assembly: string;
  assemblyCode: string;
  quantity: string;
  unit: string;
  notes: string;
  position: string;
  model: string;
  year: string;
  engine: string;
  vehicleType: string;
  representativeVin: string;
  vinCount: number;
  figure: string;
  groupTitle: string;
};

export type PartDetail = {
  partNumber: string;
  description: string;
  descriptionChinese: string;
  descriptionHebrew: string | null;
  occurrences: PartOccurrence[];
};

/**
 * The predicate and tier expression behind every part search.
 *
 * Part numbers match on the separator-free form, so "37478600012",
 * "3747 86 00012" and "3747-86-00012" all reach the same part. A description
 * hit has to cover every token; a part-number hit stands on its own.
 */
function matchClauses(query: string): { where: SQL; tier: SQL } | null {
  const loose = looseOf(query);
  const tokens = tokensOf(query);
  const hasNumber = loose.length >= 2 && /\d/.test(loose);
  if (!hasNumber && !tokens.length) return null;

  const numberMatch = hasNumber ? sql`p.loose LIKE ${`%${loose}%`}` : sql`0`;
  const textMatch = tokens.length
    ? sql`(${sql.join(tokens.map((token) => sql`p.haystack LIKE ${`%${token}%`}`), sql` AND `)})`
    : sql`0`;

  const tier = hasNumber
    ? sql`CASE
          WHEN p.loose = ${loose} THEN 0
          WHEN p.loose LIKE ${`${loose}%`} THEN 1
          WHEN p.loose LIKE ${`%${loose}%`} THEN 2
          ELSE 3 END`
    : sql`3`;

  return { where: sql`(${numberMatch}) OR (${textMatch})`, tier };
}

type SearchRow = {
  part_number: string;
  description: string;
  description_hebrew: string | null;
  occurrence_count: number;
  tier: number;
  models: string | null;
};

export async function searchParts(
  query: string,
  limit: number,
  scope?: { catalog?: string },
): Promise<{ total: number; results: SearchHit[] }> {
  const clauses = matchClauses(query.trim());
  if (!clauses) return { total: 0, results: [] };

  const db = getDb();
  const scoped = scope?.catalog
    ? sql`AND EXISTS (SELECT 1 FROM occurrences o2
                      WHERE o2.part_number = p.part_number AND o2.catalog = ${scope.catalog})`
    : sql``;

  const totals = await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM parts p WHERE (${clauses.where}) ${scoped}`,
  );
  const rows = await db.all<SearchRow>(sql`
    SELECT p.part_number, p.description, p.description_hebrew, p.occurrence_count,
           ${clauses.tier} AS tier,
           (SELECT GROUP_CONCAT(DISTINCT o.model) FROM occurrences o
             WHERE o.part_number = p.part_number) AS models
    FROM parts p
    WHERE (${clauses.where}) ${scoped}
    ORDER BY tier ASC, LENGTH(p.part_number) ASC, p.part_number ASC
    LIMIT ${limit}
  `);

  return {
    total: totals[0]?.total ?? 0,
    results: rows.map((row) => ({
      partNumber: row.part_number,
      description: row.description,
      descriptionHebrew: row.description_hebrew,
      occurrenceCount: row.occurrence_count,
      via: row.tier < 3 ? "part" : "description",
      models: row.models ? row.models.split(",").filter(Boolean) : [],
    })),
  };
}

type OccurrenceRow = {
  group_id: string; catalog: string; assembly: string; assembly_code: string;
  quantity: string; unit: string; notes: string; position: string; model: string;
  year: string; engine: string; vehicle_type: string; representative_vin: string;
  vin_count: number; figure: string | null; group_title: string | null;
};

const toOccurrence = (row: OccurrenceRow): PartOccurrence => ({
  groupId: row.group_id,
  catalog: row.catalog,
  assembly: row.assembly,
  assemblyCode: row.assembly_code,
  quantity: row.quantity,
  unit: row.unit,
  notes: row.notes,
  position: row.position,
  model: row.model,
  year: row.year,
  engine: row.engine,
  vehicleType: row.vehicle_type,
  representativeVin: row.representative_vin,
  vinCount: row.vin_count,
  figure: row.figure ?? "",
  groupTitle: row.group_title ?? "",
});

export async function getPart(partNumber: string): Promise<PartDetail | null> {
  const requested = partNumber.trim();
  if (!requested) return null;

  const db = getDb();
  const loose = looseOf(requested);
  const parts = await db.all<{
    part_number: string; description: string;
    description_chinese: string; description_hebrew: string | null;
  }>(sql`
    SELECT part_number, description, description_chinese, description_hebrew
    FROM parts WHERE part_number = ${requested} OR loose = ${loose}
    ORDER BY CASE WHEN part_number = ${requested} THEN 0 ELSE 1 END
    LIMIT 1
  `);
  const part = parts[0];
  if (!part) return null;

  const occurrences = await db.all<OccurrenceRow>(sql`
    SELECT o.group_id, o.catalog, o.assembly, o.assembly_code, o.quantity, o.unit,
           o.notes, o.position, o.model, o.year, o.engine, o.vehicle_type,
           o.representative_vin, o.vin_count, g.figure, g.title AS group_title
    FROM occurrences o
    LEFT JOIN groups g ON g.id = o.group_id
    WHERE o.part_number = ${part.part_number}
    ORDER BY o.catalog ASC, o.assembly ASC
  `);

  return {
    partNumber: part.part_number,
    description: part.description,
    descriptionChinese: part.description_chinese,
    descriptionHebrew: part.description_hebrew,
    occurrences: occurrences.map(toOccurrence),
  };
}

/** Every part drawn in one assembly, in diagram-position order. */
export async function listAssembly(groupId: string) {
  const db = getDb();
  const groups = await db.all<{ id: string; catalog: string; code: string; title: string; figure: string }>(
    sql`SELECT id, catalog, code, title, figure FROM groups WHERE id = ${groupId}`,
  );
  const group = groups[0];
  if (!group) return null;

  const rows = await db.all<{
    part_number: string; position: string; quantity: string; unit: string;
    description: string; description_hebrew: string | null;
  }>(sql`
    SELECT o.part_number, o.position, o.quantity, o.unit, o.description,
           p.description_hebrew
    FROM occurrences o
    LEFT JOIN parts p ON p.part_number = o.part_number
    WHERE o.group_id = ${groupId}
    ORDER BY CAST(NULLIF(o.position, '') AS INTEGER) ASC, o.part_number ASC
  `);

  return {
    groupId: group.id,
    catalog: group.catalog,
    code: group.code,
    title: group.title,
    figure: group.figure,
    parts: rows.map((row) => ({
      partNumber: row.part_number,
      position: row.position,
      quantity: row.quantity,
      unit: row.unit,
      description: row.description,
      descriptionHebrew: row.description_hebrew,
    })),
  };
}

/** The catalog a chassis number belongs to, and optionally a search inside it. */
export async function partsForVin(vin: string, query?: string, limit = 20) {
  const db = getDb();
  const normalized = vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rows = await db.all<{ catalog: string }>(
    sql`SELECT catalog FROM catalog_vins WHERE vin = ${normalized} LIMIT 1`,
  );
  const catalog = rows[0]?.catalog;
  if (!catalog) return null;

  const catalogs = await db.all<{
    model: string; year: string; engine: string; vehicle_type: string; part_count: number;
  }>(sql`SELECT model, year, engine, vehicle_type, part_count FROM catalogs WHERE catalog = ${catalog}`);

  const found = query?.trim()
    ? await searchParts(query, limit, { catalog })
    : { total: catalogs[0]?.part_count ?? 0, results: [] as SearchHit[] };

  return {
    vin: normalized,
    catalog,
    model: catalogs[0]?.model ?? "",
    year: catalogs[0]?.year ?? "",
    engine: catalogs[0]?.engine ?? "",
    vehicleType: catalogs[0]?.vehicle_type ?? "",
    total: found.total,
    results: found.results,
  };
}
