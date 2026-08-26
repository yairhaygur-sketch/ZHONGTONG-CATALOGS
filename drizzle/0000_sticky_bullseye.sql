CREATE TABLE `catalog_vins` (
	`vin` text NOT NULL,
	`catalog` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_vins_vin_idx` ON `catalog_vins` (`vin`);--> statement-breakpoint
CREATE INDEX `catalog_vins_catalog_idx` ON `catalog_vins` (`catalog`);--> statement-breakpoint
CREATE TABLE `catalogs` (
	`catalog` text PRIMARY KEY NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`engine` text DEFAULT '' NOT NULL,
	`vehicle_type` text DEFAULT '' NOT NULL,
	`part_count` integer DEFAULT 0 NOT NULL,
	`vin_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`figure` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `groups_catalog_idx` ON `groups` (`catalog`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_number` text NOT NULL,
	`group_id` text DEFAULT '' NOT NULL,
	`catalog` text NOT NULL,
	`assembly` text DEFAULT '' NOT NULL,
	`assembly_code` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`description_chinese` text DEFAULT '' NOT NULL,
	`quantity` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`position` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`engine` text DEFAULT '' NOT NULL,
	`vehicle_type` text DEFAULT '' NOT NULL,
	`representative_vin` text DEFAULT '' NOT NULL,
	`vin_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `occurrences_part_idx` ON `occurrences` (`part_number`);--> statement-breakpoint
CREATE INDEX `occurrences_catalog_idx` ON `occurrences` (`catalog`);--> statement-breakpoint
CREATE INDEX `occurrences_group_idx` ON `occurrences` (`group_id`);--> statement-breakpoint
CREATE TABLE `parts` (
	`part_number` text PRIMARY KEY NOT NULL,
	`loose` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`description_chinese` text DEFAULT '' NOT NULL,
	`description_hebrew` text,
	`haystack` text DEFAULT '' NOT NULL,
	`occurrence_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `parts_loose_idx` ON `parts` (`loose`);