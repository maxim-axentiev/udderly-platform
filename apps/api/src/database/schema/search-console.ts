import {
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { sourceSnapshots } from "./source-snapshots";

const metric = (name: string) => numeric(name, { precision: 20, scale: 9 });

const gscMetrics = {
  clicks: metric("clicks"),
  impressions: metric("impressions"),
  ctr: metric("ctr"),
  position: metric("position"),
};

/**
 * Latest observed Search Console site. Not a historical permission timeline.
 * `gsc_date` on fact tables is Google's Search Analytics civil date
 * (America/Los_Angeles). It is not converted to America/Toronto.
 */
export const searchConsoleProperties = pgTable(
  "search_console_property",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    permissionLevel: text("permission_level"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_property_site_uidx").on(table.siteUrl),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_property_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const searchConsoleDailyTotals = pgTable(
  "search_console_daily_total",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    gscDate: date("gsc_date").notNull(),
    ...gscMetrics,
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_daily_total_site_date_uidx").on(
      table.siteUrl,
      table.gscDate,
    ),
    index("search_console_daily_total_date_idx").on(table.gscDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_daily_total_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const searchConsoleQueries = pgTable(
  "search_console_query",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    gscDate: date("gsc_date").notNull(),
    query: text("query").notNull(),
    ...gscMetrics,
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_query_grain_uidx").on(
      table.siteUrl,
      table.gscDate,
      table.query,
    ),
    index("search_console_query_date_idx").on(table.gscDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_query_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const searchConsolePages = pgTable(
  "search_console_page",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    gscDate: date("gsc_date").notNull(),
    page: text("page").notNull(),
    ...gscMetrics,
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_page_grain_uidx").on(
      table.siteUrl,
      table.gscDate,
      table.page,
    ),
    index("search_console_page_date_idx").on(table.gscDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_page_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const searchConsoleCountries = pgTable(
  "search_console_country",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    gscDate: date("gsc_date").notNull(),
    country: text("country").notNull(),
    ...gscMetrics,
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_country_grain_uidx").on(
      table.siteUrl,
      table.gscDate,
      table.country,
    ),
    index("search_console_country_date_idx").on(table.gscDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_country_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const searchConsoleDevices = pgTable(
  "search_console_device",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    gscDate: date("gsc_date").notNull(),
    device: text("device").notNull(),
    ...gscMetrics,
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_device_grain_uidx").on(
      table.siteUrl,
      table.gscDate,
      table.device,
    ),
    index("search_console_device_date_idx").on(table.gscDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_device_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const searchConsoleSearchAppearances = pgTable(
  "search_console_search_appearance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteUrl: text("site_url").notNull(),
    gscDate: date("gsc_date").notNull(),
    searchAppearance: text("search_appearance").notNull(),
    ...gscMetrics,
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("search_console_search_appearance_grain_uidx").on(
      table.siteUrl,
      table.gscDate,
      table.searchAppearance,
    ),
    index("search_console_search_appearance_date_idx").on(table.gscDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "search_console_search_appearance_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);
