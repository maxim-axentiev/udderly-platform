import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./columns";
import { sourceSnapshots } from "./source-snapshots";

const metric = (name: string) => numeric(name, { precision: 20, scale: 9 });

/**
 * Latest observed GA4 property configuration. Not a historical config timeline.
 * Interpret `source_snapshot.observed_at` as when this current-state view was ingested.
 */
export const analyticsProperties = pgTable(
  "analytics_property",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    displayName: text("display_name").notNull(),
    timeZone: text("time_zone").notNull(),
    currencyCode: text("currency_code").notNull(),
    industryCategory: text("industry_category"),
    serviceLevel: text("service_level"),
    propertyType: text("property_type"),
    accountExternalId: text("account_external_id"),
    createTime: timestamptz("provider_create_time"),
    updateTime: timestamptz("provider_update_time"),
    eventDataRetention: text("event_data_retention"),
    userDataRetention: text("user_data_retention"),
    resetUserDataOnNewActivity: text("reset_user_data_on_new_activity"),
    reportingIdentity: text("reporting_identity"),
    acquisitionLookback: text("acquisition_lookback"),
    otherConversionLookback: text("other_conversion_lookback"),
    reportingAttributionModel: text("reporting_attribution_model"),
    adsWebConversionExportScope: text("ads_web_conversion_export_scope"),
    streamExternalId: text("stream_external_id"),
    streamDisplayName: text("stream_display_name"),
    streamType: text("stream_type"),
    measurementId: text("measurement_id"),
    defaultUri: text("default_uri"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_property_external_uidx").on(table.propertyExternalId),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_property_source_snapshot_id_fk",
    }).onDelete("restrict"),
    check(
      "analytics_property_currency_len",
      sql`char_length(${table.currencyCode}) = 3`,
    ),
  ],
);

export const analyticsKeyEvents = pgTable(
  "analytics_key_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    eventName: text("event_name").notNull(),
    resourceName: text("resource_name").notNull(),
    countingMethod: text("counting_method"),
    custom: text("custom"),
    providerCreateTime: timestamptz("provider_create_time"),
    defaultCurrencyCode: text("default_currency_code"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_key_event_property_name_uidx").on(
      table.propertyExternalId,
      table.eventName,
    ),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_key_event_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsDailyTotals = pgTable(
  "analytics_daily_total",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    sessions: metric("sessions"),
    activeUsers: metric("active_users"),
    totalUsers: metric("total_users"),
    newUsers: metric("new_users"),
    engagedSessions: metric("engaged_sessions"),
    engagementRate: metric("engagement_rate"),
    bounceRate: metric("bounce_rate"),
    averageSessionDuration: metric("average_session_duration"),
    userEngagementDuration: metric("user_engagement_duration"),
    eventCount: metric("event_count"),
    screenPageViews: metric("screen_page_views"),
    keyEvents: metric("key_events"),
    ecommercePurchases: metric("ecommerce_purchases"),
    transactions: metric("transactions"),
    purchaseRevenue: metric("purchase_revenue"),
    itemsPurchased: metric("items_purchased"),
    addToCarts: metric("add_to_carts"),
    currencyCode: text("currency_code"),
    siteTotalsSnapshotId: uuid("site_totals_snapshot_id"),
    engagementSnapshotId: uuid("engagement_snapshot_id"),
    ecommerceTotalsSnapshotId: uuid("ecommerce_totals_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_daily_total_property_date_uidx").on(
      table.propertyExternalId,
      table.farmDate,
    ),
    index("analytics_daily_total_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.siteTotalsSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_daily_total_site_snapshot_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.engagementSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_daily_total_engagement_snapshot_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.ecommerceTotalsSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_daily_total_ecommerce_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsSessionAcquisition = pgTable(
  "analytics_session_acquisition",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    sessionSource: text("session_source").notNull(),
    sessionMedium: text("session_medium").notNull(),
    sessionDefaultChannelGroup: text("session_default_channel_group").notNull(),
    sessions: metric("sessions"),
    engagedSessions: metric("engaged_sessions"),
    keyEvents: metric("key_events"),
    bounceRate: metric("bounce_rate"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_session_acq_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.sessionSource,
      table.sessionMedium,
      table.sessionDefaultChannelGroup,
    ),
    index("analytics_session_acq_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_session_acq_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsFirstUserAcquisition = pgTable(
  "analytics_first_user_acquisition",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    firstUserSource: text("first_user_source").notNull(),
    firstUserMedium: text("first_user_medium").notNull(),
    firstUserDefaultChannelGroup: text(
      "first_user_default_channel_group",
    ).notNull(),
    newUsers: metric("new_users"),
    activeUsers: metric("active_users"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_first_user_acq_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.firstUserSource,
      table.firstUserMedium,
      table.firstUserDefaultChannelGroup,
    ),
    index("analytics_first_user_acq_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_first_user_acq_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsLandingPages = pgTable(
  "analytics_landing_page",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    landingPage: text("landing_page").notNull(),
    sessions: metric("sessions"),
    engagedSessions: metric("engaged_sessions"),
    keyEvents: metric("key_events"),
    activeUsers: metric("active_users"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_landing_page_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.landingPage,
    ),
    index("analytics_landing_page_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_landing_page_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsPagePaths = pgTable(
  "analytics_page_path",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    pagePath: text("page_path").notNull(),
    screenPageViews: metric("screen_page_views"),
    eventCount: metric("event_count"),
    activeUsers: metric("active_users"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_page_path_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.pagePath,
    ),
    index("analytics_page_path_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_page_path_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    eventName: text("event_name").notNull(),
    eventCount: metric("event_count"),
    activeUsers: metric("active_users"),
    keyEvents: metric("key_events"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_event_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.eventName,
    ),
    index("analytics_event_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_event_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsCountries = pgTable(
  "analytics_country",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    country: text("country").notNull(),
    sessions: metric("sessions"),
    activeUsers: metric("active_users"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_country_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.country,
    ),
    index("analytics_country_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_country_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsDevices = pgTable(
  "analytics_device",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    deviceCategory: text("device_category").notNull(),
    sessions: metric("sessions"),
    engagedSessions: metric("engaged_sessions"),
    activeUsers: metric("active_users"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_device_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.deviceCategory,
    ),
    index("analytics_device_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_device_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const analyticsEcommerceItems = pgTable(
  "analytics_ecommerce_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyExternalId: text("property_external_id").notNull(),
    farmDate: date("farm_date").notNull(),
    itemId: text("item_id").notNull(),
    itemsViewed: metric("items_viewed"),
    itemsAddedToCart: metric("items_added_to_cart"),
    itemsPurchased: metric("items_purchased"),
    itemRevenue: metric("item_revenue"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("analytics_ecommerce_item_grain_uidx").on(
      table.propertyExternalId,
      table.farmDate,
      table.itemId,
    ),
    index("analytics_ecommerce_item_date_idx").on(table.farmDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "analytics_ecommerce_item_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);
