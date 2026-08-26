import { sql } from "drizzle-orm";
import { getDb } from "../../../db";

const MAX_LIMIT = 50;

const looseOf = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokensOf = (value: string) =>
  value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);

type Row = {
  part_number: string;
  description: string;
  description_hebrew: string | null;
  occurrence_count: number;
  tier: number;
  models: string | null;
};

/**
 * Ranked catalog search, server side.
 *
 * Part numbers are matched on the separator-free form, so "37478600012",
 * "3747 86 00012" and "3747-86-00012" all reach the same part. Tiers mirror the
 * client ranking: exact, prefix, contains, then description.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit")) || 8, MAX_LIMIT);

  if (query.length < 2) {
    return Response.json({ query, total: 0, results: [] });
  }

  try {
    const db = getDb();
    const loose = looseOf(query);
    const tokens = tokensOf(query);
    const hasNumber = loose.length >= 2 && /\d/.test(loose);

    const conditions = [];
    if (hasNumber) conditions.push(sql`p.loose LIKE ${`%${loose}%`}`);
    for (const token of tokens) conditions.push(sql`p.haystack LIKE ${`%${token}%`}`);
    if (!conditions.length) {
      return Response.json({ query, total: 0, results: [] });
    }

    // A part-number hit stands alone; a description hit must cover every token.
    const textMatch = tokens.length
      ? sql`(${sql.join(tokens.map((token) => sql`p.haystack LIKE ${`%${token}%`}`), sql` AND `)})`
      : sql`0`;
    const numberMatch = hasNumber ? sql`p.loose LIKE ${`%${loose}%`}` : sql`0`;

    const tier = hasNumber
      ? sql`CASE
            WHEN p.loose = ${loose} THEN 0
            WHEN p.loose LIKE ${`${loose}%`} THEN 1
            WHEN p.loose LIKE ${`%${loose}%`} THEN 2
            ELSE 3 END`
      : sql`3`;

    const where = sql`(${numberMatch}) OR (${textMatch})`;

    const totalRows = await db.all<{ total: number }>(
      sql`SELECT COUNT(*) AS total FROM parts p WHERE ${where}`,
    );

    const rows = await db.all<Row>(sql`
      SELECT p.part_number, p.description, p.description_hebrew, p.occurrence_count,
             ${tier} AS tier,
             (SELECT GROUP_CONCAT(DISTINCT o.model) FROM occurrences o
               WHERE o.part_number = p.part_number) AS models
      FROM parts p
      WHERE ${where}
      ORDER BY tier ASC, LENGTH(p.part_number) ASC, p.part_number ASC
      LIMIT ${limit}
    `);

    return Response.json({
      query,
      total: totalRows[0]?.total ?? 0,
      results: rows.map((row) => ({
        partNumber: row.part_number,
        description: row.description,
        descriptionHebrew: row.description_hebrew,
        occurrenceCount: row.occurrence_count,
        via: row.tier < 3 ? "part" : "description",
        models: row.models ? row.models.split(",").filter(Boolean) : [],
      })),
    });
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
