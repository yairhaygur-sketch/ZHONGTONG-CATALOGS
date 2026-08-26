import { sql } from "drizzle-orm";
import { getDb } from "../../../db";

type CatalogRow = {
  catalog: string;
  model: string;
  year: string;
  engine: string;
  vehicle_type: string;
  part_count: number;
  vin_count: number;
};

/**
 * Counts and catalog list for the landing page.
 *
 * These are the only numbers the home screen needs, so it can paint from a few
 * kilobytes instead of waiting for the full catalog to download.
 */
export async function GET() {
  try {
    const db = getDb();
    const [counts] = await db.all<{
      unique_parts: number;
      occurrence_count: number;
      catalog_count: number;
      vin_count: number;
      figure_count: number;
    }>(sql`
      SELECT (SELECT COUNT(*) FROM parts) AS unique_parts,
             (SELECT COUNT(*) FROM occurrences) AS occurrence_count,
             (SELECT COUNT(*) FROM catalogs) AS catalog_count,
             (SELECT COUNT(*) FROM catalog_vins) AS vin_count,
             (SELECT COUNT(DISTINCT figure) FROM groups WHERE figure <> '') AS figure_count
    `);
    const catalogs = await db.all<CatalogRow>(sql`
      SELECT catalog, model, year, engine, vehicle_type, part_count, vin_count
      FROM catalogs ORDER BY model ASC, year ASC
    `);
    const [generated] = await db.all<{ value: string }>(
      sql`SELECT value FROM meta WHERE key = 'generated'`,
    );

    return Response.json({
      generated: generated?.value ?? "",
      uniqueParts: counts?.unique_parts ?? 0,
      occurrenceCount: counts?.occurrence_count ?? 0,
      catalogCount: counts?.catalog_count ?? 0,
      figureCount: counts?.figure_count ?? 0,
      vinCount: counts?.vin_count ?? 0,
      catalogs: catalogs.map((row) => ({
        catalog: row.catalog,
        model: row.model,
        year: row.year,
        engine: row.engine,
        vehicleType: row.vehicle_type,
        parts: row.part_count,
        vins: row.vin_count,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
