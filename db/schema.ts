import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One supplier workbook: a vehicle model/year/engine combination. */
export const catalogs = sqliteTable("catalogs", {
  catalog: text("catalog").primaryKey(),
  model: text("model").notNull().default(""),
  year: text("year").notNull().default(""),
  engine: text("engine").notNull().default(""),
  vehicleType: text("vehicle_type").notNull().default(""),
  partCount: integer("part_count").notNull().default(0),
  vinCount: integer("vin_count").notNull().default(0),
});

/** Chassis numbers a catalog applies to. Searched on its own, so it gets a table. */
export const catalogVins = sqliteTable(
  "catalog_vins",
  {
    vin: text("vin").notNull(),
    catalog: text("catalog").notNull(),
  },
  (table) => [
    index("catalog_vins_vin_idx").on(table.vin),
    index("catalog_vins_catalog_idx").on(table.catalog),
  ],
);

/** An assembly within a catalog, with its manufacturer diagram. */
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    catalog: text("catalog").notNull(),
    code: text("code").notNull().default(""),
    title: text("title").notNull().default(""),
    figure: text("figure").notNull().default(""),
  },
  (table) => [index("groups_catalog_idx").on(table.catalog)],
);

/**
 * A part number, deduplicated across catalogs.
 * `loose` is the separator-free form so "37478600012" finds "3747-86-00012";
 * `haystack` is the lowercased text the description search scans.
 */
export const parts = sqliteTable(
  "parts",
  {
    partNumber: text("part_number").primaryKey(),
    loose: text("loose").notNull(),
    description: text("description").notNull().default(""),
    descriptionChinese: text("description_chinese").notNull().default(""),
    descriptionHebrew: text("description_hebrew"),
    haystack: text("haystack").notNull().default(""),
    occurrenceCount: integer("occurrence_count").notNull().default(0),
  },
  (table) => [index("parts_loose_idx").on(table.loose)],
);

/** The part as it appears in one assembly of one catalog, at one diagram position. */
export const occurrences = sqliteTable(
  "occurrences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    partNumber: text("part_number").notNull(),
    groupId: text("group_id").notNull().default(""),
    catalog: text("catalog").notNull(),
    assembly: text("assembly").notNull().default(""),
    assemblyCode: text("assembly_code").notNull().default(""),
    description: text("description").notNull().default(""),
    descriptionChinese: text("description_chinese").notNull().default(""),
    quantity: text("quantity").notNull().default(""),
    unit: text("unit").notNull().default(""),
    notes: text("notes").notNull().default(""),
    position: text("position").notNull().default(""),
    model: text("model").notNull().default(""),
    year: text("year").notNull().default(""),
    engine: text("engine").notNull().default(""),
    vehicleType: text("vehicle_type").notNull().default(""),
    representativeVin: text("representative_vin").notNull().default(""),
    vinCount: integer("vin_count").notNull().default(0),
  },
  (table) => [
    index("occurrences_part_idx").on(table.partNumber),
    index("occurrences_catalog_idx").on(table.catalog),
    index("occurrences_group_idx").on(table.groupId),
  ],
);

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
