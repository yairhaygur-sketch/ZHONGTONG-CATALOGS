import { sql } from "drizzle-orm";
import { getDb } from "../../../../db";

const looseOf = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

type PartRow = {
  part_number: string;
  description: string;
  description_chinese: string;
  description_hebrew: string | null;
};

type OccurrenceRow = {
  group_id: string;
  catalog: string;
  assembly: string;
  assembly_code: string;
  quantity: string;
  unit: string;
  notes: string;
  position: string;
  model: string;
  year: string;
  engine: string;
  vehicle_type: string;
  representative_vin: string;
  vin_count: number;
  figure: string | null;
  group_title: string | null;
};

/** One part with every assembly it appears in. Accepts any separator spelling. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partNumber: string }> },
) {
  const { partNumber } = await params;
  const requested = decodeURIComponent(partNumber ?? "").trim();
  if (!requested) return Response.json({ error: "Missing part number" }, { status: 400 });

  try {
    const db = getDb();
    const loose = looseOf(requested);
    const parts = await db.all<PartRow>(sql`
      SELECT part_number, description, description_chinese, description_hebrew
      FROM parts WHERE part_number = ${requested} OR loose = ${loose}
      ORDER BY CASE WHEN part_number = ${requested} THEN 0 ELSE 1 END
      LIMIT 1
    `);
    const part = parts[0];
    if (!part) return Response.json({ error: "Part not found" }, { status: 404 });

    const occurrences = await db.all<OccurrenceRow>(sql`
      SELECT o.group_id, o.catalog, o.assembly, o.assembly_code, o.quantity, o.unit,
             o.notes, o.position, o.model, o.year, o.engine, o.vehicle_type,
             o.representative_vin, o.vin_count, g.figure, g.title AS group_title
      FROM occurrences o
      LEFT JOIN groups g ON g.id = o.group_id
      WHERE o.part_number = ${part.part_number}
      ORDER BY o.catalog ASC, o.assembly ASC
    `);

    return Response.json({
      partNumber: part.part_number,
      description: part.description,
      descriptionChinese: part.description_chinese,
      descriptionHebrew: part.description_hebrew,
      occurrences: occurrences.map((row) => ({
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
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
