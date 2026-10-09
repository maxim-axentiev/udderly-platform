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
 * Latest observed Mailchimp account. Aggregate reporting only.
 * Daily activity uses America/Toronto civil `metric_date`.
 */
export const mailchimpAccounts = pgTable(
  "mailchimp_account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountExternalId: text("account_external_id").notNull(),
    name: text("name"),
    timezoneName: text("timezone_name").notNull(),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_account_external_uidx").on(table.accountExternalId),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_account_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const mailchimpAudiences = pgTable(
  "mailchimp_audience",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listExternalId: text("list_external_id").notNull(),
    name: text("name"),
    memberCount: integer("member_count"),
    unsubscribeCount: integer("unsubscribe_count"),
    cleanedCount: integer("cleaned_count"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_audience_external_uidx").on(table.listExternalId),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_audience_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const mailchimpAudienceMonthly = pgTable(
  "mailchimp_audience_monthly",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listExternalId: text("list_external_id").notNull(),
    yearMonth: text("year_month").notNull(),
    subscribed: integer("subscribed"),
    unsubscribed: integer("unsubscribed"),
    cleaned: integer("cleaned"),
    deleted: integer("deleted"),
    pending: integer("pending"),
    reconfirm: integer("reconfirm"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_audience_monthly_grain_uidx").on(
      table.listExternalId,
      table.yearMonth,
    ),
    index("mailchimp_audience_monthly_month_idx").on(table.yearMonth),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_audience_monthly_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const mailchimpAudienceDaily = pgTable(
  "mailchimp_audience_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listExternalId: text("list_external_id").notNull(),
    metricDate: date("metric_date").notNull(),
    emailsSent: count("emails_sent"),
    uniqueOpens: count("unique_opens"),
    recipientClicks: count("recipient_clicks"),
    hardBounce: count("hard_bounce"),
    softBounce: count("soft_bounce"),
    subs: count("subs"),
    unsubs: count("unsubs"),
    otherAdds: count("other_adds"),
    otherRemoves: count("other_removes"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_audience_daily_grain_uidx").on(
      table.listExternalId,
      table.metricDate,
    ),
    index("mailchimp_audience_daily_date_idx").on(table.metricDate),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_audience_daily_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const mailchimpCampaigns = pgTable(
  "mailchimp_campaign",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignExternalId: text("campaign_external_id").notNull(),
    listExternalId: text("list_external_id"),
    type: text("type"),
    status: text("status"),
    title: text("title"),
    subjectLine: text("subject_line"),
    sendTime: text("send_time"),
    gaCampaignName: text("ga_campaign_name"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_campaign_external_uidx").on(table.campaignExternalId),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_campaign_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const mailchimpCampaignReports = pgTable(
  "mailchimp_campaign_report",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignExternalId: text("campaign_external_id").notNull(),
    listExternalId: text("list_external_id"),
    emailsSent: integer("emails_sent"),
    abuseReports: integer("abuse_reports"),
    unsubscribed: integer("unsubscribed"),
    hardBounces: integer("hard_bounces"),
    softBounces: integer("soft_bounces"),
    opensTotal: integer("opens_total"),
    uniqueOpens: integer("unique_opens"),
    proxyExcludedUniqueOpens: integer("proxy_excluded_unique_opens"),
    openRate: rate("open_rate"),
    clicksTotal: integer("clicks_total"),
    uniqueClicks: integer("unique_clicks"),
    uniqueSubscriberClicks: integer("unique_subscriber_clicks"),
    clickRate: rate("click_rate"),
    sendTime: text("send_time"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_campaign_report_external_uidx").on(
      table.campaignExternalId,
    ),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_campaign_report_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);

export const mailchimpCampaignLinks = pgTable(
  "mailchimp_campaign_link",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignExternalId: text("campaign_external_id").notNull(),
    linkExternalId: text("link_external_id").notNull(),
    url: text("url"),
    totalClicks: integer("total_clicks"),
    uniqueClicks: integer("unique_clicks"),
    sourceSnapshotId: uuid("source_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("mailchimp_campaign_link_grain_uidx").on(
      table.campaignExternalId,
      table.linkExternalId,
    ),
    foreignKey({
      columns: [table.sourceSnapshotId],
      foreignColumns: [sourceSnapshots.id],
      name: "mailchimp_campaign_link_source_snapshot_id_fk",
    }).onDelete("restrict"),
  ],
);
