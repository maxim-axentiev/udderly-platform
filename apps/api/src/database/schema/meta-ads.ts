import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { sourceSnapshots } from "./source-snapshots";

const rate = (name: string) => numeric(name, { precision: 20, scale: 9 });
const count = (name: string) => bigint(name, { mode: "number" });

/**
 * Latest observed Meta ad account. Not a historical status timeline.
 * Daily facts use America/Toronto civil `metric_date`. Spend is CAD minor units.
 */
export const metaAdsAccounts = pgTable(
  "meta_ads_account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    name: text("name"),
    currency: text("currency").notNull(),
    timezoneName: text("timezone_name").notNull(),
    accountStatus: text("account_status"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("meta_ads_account_external_uidx").on(table.accountExternalId),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_account_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const metaAdsCampaigns = pgTable(
  "meta_ads_campaign",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    campaignExternalId: text("campaign_external_id").notNull(),
    name: text("name"),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    objective: text("objective"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("meta_ads_campaign_external_uidx").on(
      table.accountExternalId,
      table.campaignExternalId,
    ),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_campaign_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const metaAdsAdSets = pgTable(
  "meta_ads_ad_set",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    adSetExternalId: text("ad_set_external_id").notNull(),
    campaignExternalId: text("campaign_external_id"),
    name: text("name"),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("meta_ads_ad_set_external_uidx").on(
      table.accountExternalId,
      table.adSetExternalId,
    ),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_ad_set_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const metaAdsAds = pgTable(
  "meta_ads_ad",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    adExternalId: text("ad_external_id").notNull(),
    adSetExternalId: text("ad_set_external_id"),
    campaignExternalId: text("campaign_external_id"),
    name: text("name"),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("meta_ads_ad_external_uidx").on(
      table.accountExternalId,
      table.adExternalId,
    ),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_ad_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

const dailyPerformance = {
  metricDate: date("metric_date").notNull(),
  attributionWindow: text("attribution_window").notNull(),
  spendAmount: integer("spend_amount").notNull(),
  currency: text("currency").notNull(),
  impressions: count("impressions"),
  clicks: count("clicks"),
  reach: count("reach"),
  frequency: rate("frequency"),
  cpc: rate("cpc"),
  cpm: rate("cpm"),
  ctr: rate("ctr"),
  sourceSnapshotId: uuid("source_snapshot_id"),
  createdAt,
  updatedAt,
};

export const metaAdsAccountDaily = pgTable(
  "meta_ads_account_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    ...dailyPerformance,
  },
  (table) => [
    uniqueIndex("meta_ads_account_daily_grain_uidx").on(
      table.accountExternalId,
      table.metricDate,
      table.attributionWindow,
    ),
    index("meta_ads_account_daily_date_idx").on(table.metricDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_account_daily_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const metaAdsCampaignDaily = pgTable(
  "meta_ads_campaign_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    campaignExternalId: text("campaign_external_id").notNull(),
    ...dailyPerformance,
  },
  (table) => [
    uniqueIndex("meta_ads_campaign_daily_grain_uidx").on(
      table.accountExternalId,
      table.campaignExternalId,
      table.metricDate,
      table.attributionWindow,
    ),
    index("meta_ads_campaign_daily_date_idx").on(table.metricDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_campaign_daily_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const metaAdsAdSetDaily = pgTable(
  "meta_ads_ad_set_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    adSetExternalId: text("ad_set_external_id").notNull(),
    campaignExternalId: text("campaign_external_id"),
    ...dailyPerformance,
  },
  (table) => [
    uniqueIndex("meta_ads_ad_set_daily_grain_uidx").on(
      table.accountExternalId,
      table.adSetExternalId,
      table.metricDate,
      table.attributionWindow,
    ),
    index("meta_ads_ad_set_daily_date_idx").on(table.metricDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_ad_set_daily_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const metaAdsAdDaily = pgTable(
  "meta_ads_ad_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    adExternalId: text("ad_external_id").notNull(),
    adSetExternalId: text("ad_set_external_id"),
    campaignExternalId: text("campaign_external_id"),
    ...dailyPerformance,
  },
  (table) => [
    uniqueIndex("meta_ads_ad_daily_grain_uidx").on(
      table.accountExternalId,
      table.adExternalId,
      table.metricDate,
      table.attributionWindow,
    ),
    index("meta_ads_ad_daily_date_idx").on(table.metricDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "meta_ads_ad_daily_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);
