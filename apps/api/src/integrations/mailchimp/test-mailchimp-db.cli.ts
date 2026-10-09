import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { EnvService } from "../../config/env.service";
import { loadEnvFiles } from "../../config/load-env";
import {
  withPostgresAdvisoryLock,
  type PostgresLockClient,
} from "../../database/advisory-lock";
import { DatabaseService } from "../../database/database.service";
import * as schema from "../../database/schema";
import {
  mailchimpAccounts,
  mailchimpAudienceDaily,
  mailchimpAudienceMonthly,
  mailchimpAudiences,
  mailchimpCampaignLinks,
  mailchimpCampaignReports,
  mailchimpCampaigns,
} from "../../database/schema/mailchimp";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { MailchimpImportService } from "./mailchimp-import.service";
import type { MailchimpClient } from "./mailchimp.client";
import {
  MAILCHIMP_IMPORT_LOCK_NAME,
  MAILCHIMP_PROVIDER,
  MAILCHIMP_REPORTING_TIME_ZONE,
} from "./mailchimp.constants";
import { formatMailchimpLockError } from "./mailchimp.errors";
import {
  assertLiveLocalComposeIdentity,
  parseApprovedMailchimpDatabaseUrl,
} from "./inspect-mailchimp-db-target";
import type { MailchimpJson, MailchimpPagedResult } from "./mailchimp.types";

const DATE_PUBLISHED = "2020-01-15";
const DATE_UNPUBLISHED = "2020-01-16";
const DATE_ROLLBACK = "2020-01-17";
const ACCOUNT_ID = "SYN-MC-ACCT";
const LIST_ID = "SYN-MC-LIST";
const CAMPAIGN_ID = "SYN-MC-CAMP";
const CAMPAIGN_MISSING_ID = "SYN-MC-CAMP-MISSING";
const LINK_ID = "SYN-MC-LINK";
const SEND_PUBLISHED = "2020-01-15T18:00:00+00:00";

function page(items: MailchimpJson[]): MailchimpPagedResult<MailchimpJson> {
  return { items, totalItems: items.length, requestCount: 1 };
}

function campaign(id: string, sendTime: string): MailchimpJson {
  return {
    id,
    type: "regular",
    status: "sent",
    send_time: sendTime,
    settings: {
      title: "Synthetic farm news",
      subject_line: "Synthetic subject",
      preview_text: "Goats",
    },
    recipients: {
      list_id: LIST_ID,
      list_name: "Synthetic list",
      recipient_count: 10,
    },
    tracking: { google_analytics: "mc-synthetic" },
  };
}

function report(
  uniqueOpens: number,
  uniqueClicks: number,
  extraClicks: Record<string, unknown> = {},
): MailchimpJson {
  return {
    id: CAMPAIGN_ID,
    campaign_title: "Synthetic farm news",
    type: "regular",
    list_id: LIST_ID,
    list_name: "Synthetic list",
    subject_line: "Synthetic subject",
    emails_sent: 10,
    abuse_reports: 0,
    unsubscribed: 0,
    send_time: SEND_PUBLISHED,
    bounces: { hard_bounces: 0, soft_bounces: 0, syntax_errors: 0 },
    opens: {
      opens_total: uniqueOpens + 2,
      unique_opens: uniqueOpens,
      open_rate: 0.4,
      proxy_excluded_unique_opens: uniqueOpens - 1,
    },
    clicks: {
      clicks_total: uniqueClicks + 1,
      unique_clicks: uniqueClicks,
      unique_subscriber_clicks: uniqueClicks,
      click_rate: 0.2,
      ...extraClicks,
    },
  };
}

function activity(day: string): MailchimpJson {
  return {
    day,
    emails_sent: 10,
    unique_opens: 4,
    recipient_clicks: 1,
    hard_bounce: 0,
    soft_bounce: 0,
    subs: 1,
    unsubs: 0,
    other_adds: 0,
    other_removes: 0,
  };
}

class FixtureMailchimpClient {
  constructor(
    private readonly state: {
      activity: MailchimpJson[];
      campaigns: MailchimpJson[];
      reports: MailchimpJson[];
      clicks: Record<string, MailchimpJson[]>;
    },
  ) {}

  async getAccount(): Promise<MailchimpJson> {
    return {
      account_id: ACCOUNT_ID,
      account_name: "Synthetic Mailchimp",
      timezone: MAILCHIMP_REPORTING_TIME_ZONE,
    };
  }

  async listAudiences(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return page([
      {
        id: LIST_ID,
        name: "Synthetic list",
        stats: {
          member_count: 10,
          unsubscribe_count: 0,
          cleaned_count: 0,
        },
      },
    ]);
  }

  async listGrowthHistory(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return page([
      {
        list_id: LIST_ID,
        month: "2020-01",
        subscribed: 10,
        unsubscribed: 0,
        cleaned: 0,
        deleted: 0,
        pending: 0,
        reconfirm: 0,
      },
    ]);
  }

  async listActivity(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return page(this.state.activity);
  }

  async listSentCampaigns(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return page(this.state.campaigns);
  }

  async listReports(): Promise<MailchimpPagedResult<MailchimpJson>> {
    return page(this.state.reports);
  }

  async listClickDetails(
    campaignId: string,
  ): Promise<MailchimpPagedResult<MailchimpJson>> {
    return page(this.state.clicks[campaignId] ?? []);
  }
}

function asClient(fixture: FixtureMailchimpClient): MailchimpClient {
  return fixture as unknown as MailchimpClient;
}

function completeState(uniqueOpens = 40): ConstructorParameters<
  typeof FixtureMailchimpClient
>[0] {
  return {
    activity: [activity(DATE_PUBLISHED)],
    campaigns: [campaign(CAMPAIGN_ID, SEND_PUBLISHED)],
    reports: [report(uniqueOpens, 8)],
    clicks: {
      [CAMPAIGN_ID]: [
        {
          id: LINK_ID,
          url: "https://udderlyridiculousfarmlife.com/visit",
          total_clicks: 7,
          unique_clicks: 6,
        },
      ],
    },
  };
}

function asDate(value: unknown): string {
  return String(value).slice(0, 10);
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = "cause" in error ? error.cause : undefined;
  return `${error.message}\n${cause instanceof Error ? cause.message : String(cause ?? "")}`;
}

async function warehouseCounts(client: postgres.Sql) {
  const rows = await client`
    SELECT
      (SELECT count(*) FROM analytics_daily_total)::int AS ga_daily,
      (SELECT count(*) FROM analytics_property)::int AS ga_property,
      (SELECT count(*) FROM search_console_query)::int AS gsc_query,
      (SELECT count(*) FROM search_console_country)::int AS gsc_country,
      (SELECT count(*) FROM search_console_page)::int AS gsc_page,
      (SELECT count(*) FROM search_console_device)::int AS gsc_device,
      (SELECT count(*) FROM search_console_search_appearance)::int AS gsc_appearance,
      (SELECT count(*) FROM search_console_daily_total)::int AS gsc_daily,
      (SELECT count(*) FROM search_console_property)::int AS gsc_property,
      (SELECT count(*) FROM meta_ads_account)::int AS meta_account,
      (SELECT count(*) FROM meta_ads_campaign_daily)::int AS meta_campaign_daily,
      (SELECT count(*) FROM booking)::int AS booking,
      (SELECT count(*) FROM visit)::int AS visit,
      (SELECT count(*) FROM integration_events)::int AS events,
      (SELECT count(*) FROM integration_events WHERE provider = 'fareharbor')::int AS fareharbor_events,
      (SELECT count(*) FROM integration_events WHERE provider = 'wherewolf')::int AS wherewolf_events,
      (SELECT count(*) FROM source_snapshot)::int AS snapshots,
      (SELECT count(*) FROM source_identity)::int AS identities,
      (SELECT count(*) FROM source_snapshot WHERE provider = 'google_analytics')::int AS ga_snapshots,
      (SELECT count(*) FROM source_snapshot WHERE provider = 'google_search_console')::int AS gsc_snapshots,
      (SELECT count(*) FROM source_snapshot WHERE provider = 'meta_ads')::int AS meta_snapshots,
      (SELECT count(*) FROM source_snapshot WHERE provider = 'mailchimp')::int AS mailchimp_snapshots,
      (SELECT count(*) FROM source_identity WHERE provider = 'mailchimp')::int AS mailchimp_identities
  `;
  return rows[0] as Record<string, number>;
}

async function mailchimpFactCounts(client: postgres.Sql) {
  const rows = await client`
    SELECT
      (SELECT count(*) FROM mailchimp_account)::int AS account,
      (SELECT count(*) FROM mailchimp_audience)::int AS audience,
      (SELECT count(*) FROM mailchimp_audience_monthly)::int AS monthly,
      (SELECT count(*) FROM mailchimp_audience_daily)::int AS daily,
      (SELECT count(*) FROM mailchimp_campaign)::int AS campaign,
      (SELECT count(*) FROM mailchimp_campaign_report)::int AS report,
      (SELECT count(*) FROM mailchimp_campaign_link)::int AS link
  `;
  return rows[0] as Record<string, number>;
}

function withoutMailchimp(counts: Record<string, number>): Record<string, number> {
  const { mailchimp_snapshots, mailchimp_identities, ...rest } = counts;
  void mailchimp_snapshots;
  void mailchimp_identities;
  return rest;
}

async function cleanupSynthetic(
  db: DatabaseService["db"],
  client: postgres.Sql,
): Promise<void> {
  await client.unsafe(`
    DROP TRIGGER IF EXISTS mailchimp_phase_d_rollback_probe_trg ON mailchimp_audience_daily;
    DROP FUNCTION IF EXISTS mailchimp_phase_d_rollback_probe();
  `);
  await db
    .delete(mailchimpCampaignLinks)
    .where(eq(mailchimpCampaignLinks.campaignExternalId, CAMPAIGN_ID));
  await db
    .delete(mailchimpCampaignReports)
    .where(eq(mailchimpCampaignReports.campaignExternalId, CAMPAIGN_ID));
  await db
    .delete(mailchimpCampaignReports)
    .where(eq(mailchimpCampaignReports.campaignExternalId, CAMPAIGN_MISSING_ID));
  await db
    .delete(mailchimpCampaigns)
    .where(eq(mailchimpCampaigns.campaignExternalId, CAMPAIGN_ID));
  await db
    .delete(mailchimpCampaigns)
    .where(eq(mailchimpCampaigns.campaignExternalId, CAMPAIGN_MISSING_ID));
  await db
    .delete(mailchimpAudienceDaily)
    .where(eq(mailchimpAudienceDaily.listExternalId, LIST_ID));
  await db
    .delete(mailchimpAudienceMonthly)
    .where(eq(mailchimpAudienceMonthly.listExternalId, LIST_ID));
  await db.delete(mailchimpAudiences).where(eq(mailchimpAudiences.listExternalId, LIST_ID));
  await db
    .delete(mailchimpAccounts)
    .where(eq(mailchimpAccounts.accountExternalId, ACCOUNT_ID));
  await db.delete(sourceIdentities).where(eq(sourceIdentities.provider, MAILCHIMP_PROVIDER));
  await db.delete(sourceSnapshots).where(eq(sourceSnapshots.provider, MAILCHIMP_PROVIDER));
}

async function dailyOpens(
  db: DatabaseService["db"],
  date: string,
): Promise<number | undefined> {
  const rows = await db
    .select({ uniqueOpens: mailchimpAudienceDaily.uniqueOpens })
    .from(mailchimpAudienceDaily)
    .where(
      and(
        eq(mailchimpAudienceDaily.listExternalId, LIST_ID),
        eq(mailchimpAudienceDaily.metricDate, date),
      ),
    );
  return rows[0]?.uniqueOpens ?? undefined;
}

async function reportOpens(db: DatabaseService["db"]): Promise<number | undefined> {
  const rows = await db
    .select({ uniqueOpens: mailchimpCampaignReports.uniqueOpens })
    .from(mailchimpCampaignReports)
    .where(eq(mailchimpCampaignReports.campaignExternalId, CAMPAIGN_ID));
  return rows[0]?.uniqueOpens ?? undefined;
}

async function linkCount(db: DatabaseService["db"]): Promise<number> {
  const rows = await db
    .select({ id: mailchimpCampaignLinks.id })
    .from(mailchimpCampaignLinks)
    .where(eq(mailchimpCampaignLinks.campaignExternalId, CAMPAIGN_ID));
  return rows.length;
}

async function snapshotCount(db: DatabaseService["db"]): Promise<number> {
  const rows = await db
    .select({ id: sourceSnapshots.id })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.provider, MAILCHIMP_PROVIDER));
  return rows.length;
}

async function assertNoMailchimpPii(db: DatabaseService["db"]): Promise<void> {
  const rows = await db
    .select({ payload: sourceSnapshots.payload })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.provider, MAILCHIMP_PROVIDER));
  const blob = JSON.stringify(rows).toLowerCase();
  assert.equal(blob.includes("email_address"), false);
  assert.equal(blob.includes("@example.com"), false);
  assert.equal(blob.includes("members"), false);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = new EnvService();
  const target = parseApprovedMailchimpDatabaseUrl(env.databaseUrl);
  const identity = await assertLiveLocalComposeIdentity(env.databaseUrl);
  console.log(
    `target host=${target.host} port=${target.port} db=${identity.db} server=${identity.serverAddr} data_directory=${identity.dataDirectory}`,
  );

  const client = postgres(env.databaseUrl, {
    max: 6,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  const database = new DatabaseService(db, client);
  const importer = new MailchimpImportService(database, env);

  try {
    const required = [
      "mailchimp_account",
      "mailchimp_audience",
      "mailchimp_audience_daily",
      "mailchimp_audience_monthly",
      "mailchimp_campaign",
      "mailchimp_campaign_link",
      "mailchimp_campaign_report",
    ];
    const present = await client`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename LIKE 'mailchimp%'
      ORDER BY 1
    `;
    assert.deepEqual(
      present.map((row) => String(row.tablename)),
      required,
    );
    const indexes = await client`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'mailchimp_account_external_uidx',
          'mailchimp_audience_external_uidx',
          'mailchimp_audience_monthly_grain_uidx',
          'mailchimp_audience_daily_grain_uidx',
          'mailchimp_campaign_external_uidx',
          'mailchimp_campaign_report_external_uidx',
          'mailchimp_campaign_link_grain_uidx'
        )
    `;
    assert.equal(indexes.length, 7);
    const fks = await client`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'f'
        AND conname LIKE 'mailchimp_%_source_snapshot_id_fk'
    `;
    assert.equal(fks.length, 7);
    console.log("schema tables keys constraints indexes PASS");

    const baseline = await warehouseCounts(client);
    assert.equal(baseline.mailchimp_snapshots, 0);
    assert.equal(baseline.mailchimp_identities, 0);

    await db.insert(mailchimpAudienceDaily).values({
      listExternalId: LIST_ID,
      metricDate: DATE_UNPUBLISHED,
      emailsSent: 99,
      uniqueOpens: 99,
    });
    await assert.rejects(
      () =>
        db.insert(mailchimpAudienceDaily).values({
          listExternalId: LIST_ID,
          metricDate: DATE_UNPUBLISHED,
          emailsSent: 1,
          uniqueOpens: 1,
        }),
      (error: unknown) => {
        assert.match(errorText(error), /unique|duplicate|grain_uidx/i);
        return true;
      },
    );
    console.log("schema unique grain constraint PASS");

    const first = await importer.importWindow({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: asClient(new FixtureMailchimpClient(completeState(40))),
    });
    assert.deepEqual(first.replacedDates, [DATE_PUBLISHED]);
    assert.equal(await dailyOpens(db, DATE_PUBLISHED), 4);
    assert.equal(await reportOpens(db), 40);
    assert.equal(await linkCount(db), 1);
    assert.equal(asDate((await db.select({
      metricDate: mailchimpAudienceDaily.metricDate,
    }).from(mailchimpAudienceDaily).where(
      and(
        eq(mailchimpAudienceDaily.listExternalId, LIST_ID),
        eq(mailchimpAudienceDaily.metricDate, DATE_PUBLISHED),
      ),
    ))[0]?.metricDate), DATE_PUBLISHED);
    const snapshotsAfterFirst = await snapshotCount(db);
    await assertNoMailchimpPii(db);

    const second = await importer.importWindow({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: asClient(new FixtureMailchimpClient(completeState(40))),
    });
    assert.deepEqual(second.replacedDates, [DATE_PUBLISHED]);
    assert.equal(await snapshotCount(db), snapshotsAfterFirst);
    assert.equal(await dailyOpens(db, DATE_PUBLISHED), 4);
    assert.equal(await reportOpens(db), 40);
    console.log("idempotent reimport PASS");

    await importer.importWindow({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: asClient(new FixtureMailchimpClient(completeState(55))),
    });
    assert.equal(await reportOpens(db), 55);
    assert.equal(await dailyOpens(db, DATE_PUBLISHED), 4);
    console.log("revised campaign metrics PASS");

    const unpublished = await importer.importWindow({
      startDate: DATE_PUBLISHED,
      endDate: DATE_UNPUBLISHED,
      client: asClient(new FixtureMailchimpClient(completeState(55))),
    });
    assert.deepEqual(unpublished.replacedDates, [DATE_PUBLISHED]);
    assert.ok(unpublished.possiblyUnpublishedDates.includes(DATE_UNPUBLISHED));
    assert.equal(await dailyOpens(db, DATE_UNPUBLISHED), 99);
    assert.equal(await dailyOpens(db, DATE_PUBLISHED), 4);
    console.log("unpublished activity does not wipe PASS");

    const missing = await importer.importWindow({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: asClient(
        new FixtureMailchimpClient({
          ...completeState(55),
          campaigns: [
            campaign(CAMPAIGN_ID, SEND_PUBLISHED),
            campaign(CAMPAIGN_MISSING_ID, SEND_PUBLISHED),
          ],
        }),
      ),
    });
    assert.ok(missing.missingReportIds.includes(CAMPAIGN_MISSING_ID));
    assert.equal(await reportOpens(db), 55);
    const missingRows = await db
      .select({ id: mailchimpCampaignReports.id })
      .from(mailchimpCampaignReports)
      .where(eq(mailchimpCampaignReports.campaignExternalId, CAMPAIGN_MISSING_ID));
    assert.equal(missingRows.length, 0);
    console.log("missing report skip PASS");

    const incompleteLinks = await importer.importWindow({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: asClient(
        new FixtureMailchimpClient({
          ...completeState(55),
          clicks: { [CAMPAIGN_ID]: [] },
        }),
      ),
    });
    assert.deepEqual(incompleteLinks.skippedIncompleteLinkIds, [CAMPAIGN_ID]);
    assert.equal(await linkCount(db), 1);
    assert.equal(await reportOpens(db), 55);
    console.log("incomplete click coverage protection PASS");

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION mailchimp_phase_d_rollback_probe()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.metric_date = DATE '${DATE_ROLLBACK}' THEN
          RAISE EXCEPTION 'synthetic_txn_rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS mailchimp_phase_d_rollback_probe_trg ON mailchimp_audience_daily;
      CREATE TRIGGER mailchimp_phase_d_rollback_probe_trg
      BEFORE INSERT ON mailchimp_audience_daily
      FOR EACH ROW EXECUTE FUNCTION mailchimp_phase_d_rollback_probe();
    `);
    await assert.rejects(
      () =>
        importer.importWindow({
          startDate: DATE_ROLLBACK,
          endDate: DATE_ROLLBACK,
          client: asClient(
            new FixtureMailchimpClient({
              ...completeState(55),
              activity: [activity(DATE_ROLLBACK)],
              campaigns: [],
              reports: [],
              clicks: {},
            }),
          ),
        }),
      (error: unknown) => {
        assert.match(errorText(error), /synthetic_txn_rollback/);
        return true;
      },
    );
    assert.equal(await dailyOpens(db, DATE_ROLLBACK), undefined);
    assert.equal(await reportOpens(db), 55);
    console.log("transaction rollback PASS");

    const holder = postgres(env.databaseUrl, { max: 1, onnotice: () => undefined });
    const waiter = postgres(env.databaseUrl, { max: 1, onnotice: () => undefined });
    try {
      await withPostgresAdvisoryLock(
        holder as unknown as PostgresLockClient,
        MAILCHIMP_IMPORT_LOCK_NAME,
        async () => {
          let ran = false;
          await assert.rejects(
            () =>
              withPostgresAdvisoryLock(
                waiter as unknown as PostgresLockClient,
                MAILCHIMP_IMPORT_LOCK_NAME,
                async () => {
                  ran = true;
                },
              ),
            /advisory_lock_busy/,
          );
          assert.equal(ran, false);
          assert.equal(
            formatMailchimpLockError("advisory_lock_busy"),
            "mailchimp_import_already_running",
          );
        },
      );
    } finally {
      await holder.end({ timeout: 2 });
      await waiter.end({ timeout: 2 });
    }
    console.log("advisory lock PASS");

    await cleanupSynthetic(db, client);
    const leftoverFacts = await mailchimpFactCounts(client);
    for (const value of Object.values(leftoverFacts)) {
      assert.equal(value, 0);
    }
    const leftover = await warehouseCounts(client);
    assert.equal(leftover.mailchimp_snapshots, 0);
    assert.equal(leftover.mailchimp_identities, 0);
    assert.deepEqual(withoutMailchimp(leftover), withoutMailchimp(baseline));
    console.log("synthetic cleanup PASS");
    console.log(
      `preservation ga_daily=${leftover.ga_daily} gsc_query=${leftover.gsc_query} meta_account=${leftover.meta_account} booking=${leftover.booking} visit=${leftover.visit} fareharbor_events=${leftover.fareharbor_events} wherewolf_events=${leftover.wherewolf_events}`,
    );
    console.log("mailchimp local database validation PASS");
  } catch (error) {
    try {
      await cleanupSynthetic(db, client);
    } catch (cleanupError) {
      console.error(cleanupError);
    }
    throw error;
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
