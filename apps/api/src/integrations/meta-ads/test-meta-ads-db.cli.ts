import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnvFiles } from "../../config/load-env";
import { EnvService } from "../../config/env.service";
import {
  withPostgresAdvisoryLock,
  type PostgresLockClient,
} from "../../database/advisory-lock";
import { DatabaseService } from "../../database/database.service";
import * as schema from "../../database/schema";
import {
  metaAdsAccountDaily,
  metaAdsAccounts,
  metaAdsAdDaily,
  metaAdsAds,
  metaAdsAdSetDaily,
  metaAdsAdSets,
  metaAdsCampaignDaily,
  metaAdsCampaigns,
} from "../../database/schema/meta-ads";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { MetaAdsImportService } from "./meta-ads-import.service";
import {
  META_ADS_ATTRIBUTION_WINDOW_ID,
  META_ADS_CANONICAL_ACCOUNT_ID,
  META_ADS_IMPORT_LOCK_NAME,
  META_ADS_PROVIDER,
} from "./meta-ads.constants";
import { mockAccount, mockCampaign } from "./meta-ads.fixtures";
import { formatMetaAdsLockError } from "./meta-ads.lock";
import type { MetaAdsClient } from "./meta-ads.client";
import type {
  MetaAdsCompletedInsights,
  MetaAdsInsightLevel,
  MetaAdsInsightRow,
  MetaAdsJson,
  MetaAdsPagedResult,
} from "./meta-ads.types";

const DATE_PUBLISHED = "2020-01-15";
const DATE_UNPUBLISHED = "2020-01-16";
const DATE_ROLLBACK = "2020-01-17";
const CAMPAIGN_ID = "SYN-META-D-CAMPAIGN";
const AD_SET_ID = "SYN-META-D-ADSET";
const AD_ID = "SYN-META-D-AD";
const AD_ROLLBACK_ID = "SYN-META-D-AD-ROLLBACK";

const BASELINE_GSC = {
  query: 3410,
  country: 525,
  page: 285,
  device: 15,
  appearance: 7,
  daily: 5,
  property: 1,
  snapshots: 7,
  identities: 7,
  events: 3,
} as const;

class FixtureMetaAdsClient {
  readonly accountId = META_ADS_CANONICAL_ACCOUNT_ID;

  constructor(
    private readonly insights: Record<MetaAdsInsightLevel, MetaAdsCompletedInsights>,
  ) {}

  async getAccount(): Promise<MetaAdsJson> {
    return { ...mockAccount };
  }

  async listCampaigns(): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    return {
      items: [{ ...mockCampaign, id: CAMPAIGN_ID }],
      requestCount: 1,
    };
  }

  async listAdSets(): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    return {
      items: [
        {
          id: AD_SET_ID,
          campaign_id: CAMPAIGN_ID,
          name: "Synthetic ad set",
          status: "ACTIVE",
          effective_status: "ACTIVE",
        },
      ],
      requestCount: 1,
    };
  }

  async listAds(): Promise<MetaAdsPagedResult<MetaAdsJson>> {
    return {
      items: [
        {
          id: AD_ID,
          adset_id: AD_SET_ID,
          campaign_id: CAMPAIGN_ID,
          name: "Synthetic ad",
          status: "ACTIVE",
          effective_status: "ACTIVE",
        },
      ],
      requestCount: 1,
    };
  }

  async listInsights(input: {
    level: MetaAdsInsightLevel;
    startDate: string;
    endDate: string;
  }): Promise<MetaAdsCompletedInsights> {
    const report = this.insights[input.level];
    return {
      ...report,
      level: input.level,
      accountId: this.accountId,
      startDate: input.startDate,
      endDate: input.endDate,
    };
  }
}

function row(
  date: string,
  objectId: string,
  spend: string,
  extra: Partial<MetaAdsInsightRow> = {},
): MetaAdsInsightRow {
  return {
    dateStart: date,
    dateStop: date,
    objectId,
    spend,
    impressions: "100",
    clicks: "4",
    ...extra,
  };
}

function report(
  level: MetaAdsInsightLevel,
  startDate: string,
  endDate: string,
  rows: MetaAdsInsightRow[],
): MetaAdsCompletedInsights {
  return {
    level,
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    startDate,
    endDate,
    attributionWindow: META_ADS_ATTRIBUTION_WINDOW_ID,
    rows,
    rowCount: rows.length,
    requestCount: 1,
  };
}

function fullWindow(
  startDate: string,
  endDate: string,
  spend = "12.34",
  campaignRows?: MetaAdsInsightRow[],
): Record<MetaAdsInsightLevel, MetaAdsCompletedInsights> {
  const accountObject = META_ADS_CANONICAL_ACCOUNT_ID.replace(/^act_/, "");
  return {
    account: report("account", startDate, endDate, [
      row(startDate, accountObject, spend),
    ]),
    campaign: report(
      "campaign",
      startDate,
      endDate,
      campaignRows ?? [
        row(startDate, CAMPAIGN_ID, spend, { campaignId: CAMPAIGN_ID }),
      ],
    ),
    adset: report("adset", startDate, endDate, [
      row(startDate, AD_SET_ID, spend, {
        campaignId: CAMPAIGN_ID,
        adsetId: AD_SET_ID,
      }),
    ]),
    ad: report("ad", startDate, endDate, [
      row(startDate, AD_ID, spend, {
        campaignId: CAMPAIGN_ID,
        adsetId: AD_SET_ID,
        adId: AD_ID,
      }),
    ]),
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

function assertApprovedTarget(databaseUrl: string): void {
  const parsed = new URL(databaseUrl.replace(/^postgresql:/, "http:"));
  if (
    parsed.hostname !== "127.0.0.1" ||
    (parsed.port || "5432") !== "5432" ||
    parsed.pathname !== "/udderly"
  ) {
    throw new Error("refusing_non_approved_database_target");
  }
}

async function warehouseCounts(client: postgres.Sql) {
  const rows = await client`
    SELECT
      (SELECT count(*) FROM search_console_query)::int AS query,
      (SELECT count(*) FROM search_console_country)::int AS country,
      (SELECT count(*) FROM search_console_page)::int AS page,
      (SELECT count(*) FROM search_console_device)::int AS device,
      (SELECT count(*) FROM search_console_search_appearance)::int AS appearance,
      (SELECT count(*) FROM search_console_daily_total)::int AS daily,
      (SELECT count(*) FROM search_console_property)::int AS property,
      (SELECT count(*) FROM source_snapshot)::int AS snapshots,
      (SELECT count(*) FROM source_identity)::int AS identities,
      (SELECT count(*) FROM integration_events)::int AS events,
      (SELECT count(*) FROM source_snapshot WHERE provider = 'google_search_console')::int AS gsc_snapshots,
      (SELECT count(*) FROM source_snapshot WHERE provider = 'meta_ads')::int AS meta_snapshots,
      (SELECT count(*) FROM source_identity WHERE provider = 'meta_ads')::int AS meta_identities,
      (SELECT count(*) FROM integration_events WHERE provider = 'fareharbor')::int AS fareharbor_events
  `;
  return rows[0] as Record<string, number>;
}

async function assertPreservedWarehouse(client: postgres.Sql): Promise<void> {
  const counts = await warehouseCounts(client);
  assert.equal(counts.query, BASELINE_GSC.query);
  assert.equal(counts.country, BASELINE_GSC.country);
  assert.equal(counts.page, BASELINE_GSC.page);
  assert.equal(counts.device, BASELINE_GSC.device);
  assert.equal(counts.appearance, BASELINE_GSC.appearance);
  assert.equal(counts.daily, BASELINE_GSC.daily);
  assert.equal(counts.property, BASELINE_GSC.property);
  assert.equal(counts.gsc_snapshots, BASELINE_GSC.snapshots);
  assert.equal(counts.identities - counts.meta_identities, BASELINE_GSC.identities);
  assert.equal(counts.snapshots - counts.meta_snapshots, BASELINE_GSC.snapshots);
  assert.equal(counts.fareharbor_events, BASELINE_GSC.events);
  assert.equal(counts.events, BASELINE_GSC.events);
}

async function cleanupSynthetic(
  db: DatabaseService["db"],
  client: postgres.Sql,
): Promise<void> {
  await client.unsafe(`
    DROP TRIGGER IF EXISTS meta_ads_phase_d_rollback_probe_trg ON meta_ads_ad_daily;
    DROP FUNCTION IF EXISTS meta_ads_phase_d_rollback_probe();
  `);
  await db.delete(metaAdsAccountDaily).where(
    eq(metaAdsAccountDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsCampaignDaily).where(
    eq(metaAdsCampaignDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsAdSetDaily).where(
    eq(metaAdsAdSetDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsAdDaily).where(
    eq(metaAdsAdDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsAds).where(
    eq(metaAdsAds.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsAdSets).where(
    eq(metaAdsAdSets.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsCampaigns).where(
    eq(metaAdsCampaigns.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(metaAdsAccounts).where(
    eq(metaAdsAccounts.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
  );
  await db.delete(sourceIdentities).where(eq(sourceIdentities.provider, META_ADS_PROVIDER));
  await db.delete(sourceSnapshots).where(eq(sourceSnapshots.provider, META_ADS_PROVIDER));
}

async function dailyCount(
  db: DatabaseService["db"],
  table:
    | typeof metaAdsAccountDaily
    | typeof metaAdsCampaignDaily
    | typeof metaAdsAdSetDaily
    | typeof metaAdsAdDaily,
  date: string,
): Promise<number> {
  const rows = await db
    .select({ metricDate: table.metricDate })
    .from(table)
    .where(
      and(
        eq(table.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
        eq(table.metricDate, date),
      ),
    );
  return rows.length;
}

async function campaignSpend(
  db: DatabaseService["db"],
  date: string,
): Promise<number | undefined> {
  const rows = await db
    .select({ spendAmount: metaAdsCampaignDaily.spendAmount })
    .from(metaAdsCampaignDaily)
    .where(
      and(
        eq(metaAdsCampaignDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
        eq(metaAdsCampaignDaily.campaignExternalId, CAMPAIGN_ID),
        eq(metaAdsCampaignDaily.metricDate, date),
      ),
    );
  return rows[0]?.spendAmount;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = new EnvService();
  assertApprovedTarget(env.databaseUrl);
  const client = postgres(env.databaseUrl, {
    max: 6,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  const database = new DatabaseService(db, client);
  const importer = new MetaAdsImportService(database, env);

  try {
    const ident = await client`
      SELECT current_database() AS db,
             inet_server_addr()::text AS server_addr,
             current_setting('data_directory') AS data_directory
    `;
    const identity = ident[0] as {
      db: string;
      server_addr: string;
      data_directory: string;
    };
    assert.equal(identity.db, "udderly");
    assert.equal(identity.data_directory, "/var/lib/postgresql/data");
    if (!identity.server_addr.startsWith("172.")) {
      throw new Error("refusing_unexpected_postgres_server_addr");
    }
    console.log(
      `target db=${identity.db} server=${identity.server_addr} data_directory=${identity.data_directory}`,
    );

    const grain = await client`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'meta_ads_campaign_daily_grain_uidx'
    `;
    assert.match(String(grain[0]?.indexdef), /attribution_window/);

    await db.insert(metaAdsAccountDaily).values({
      accountExternalId: META_ADS_CANONICAL_ACCOUNT_ID,
      metricDate: DATE_UNPUBLISHED,
      attributionWindow: META_ADS_ATTRIBUTION_WINDOW_ID,
      spendAmount: 1,
      currency: "CAD",
    });
    await assert.rejects(
      () =>
        db.insert(metaAdsAccountDaily).values({
          accountExternalId: META_ADS_CANONICAL_ACCOUNT_ID,
          metricDate: DATE_UNPUBLISHED,
          attributionWindow: META_ADS_ATTRIBUTION_WINDOW_ID,
          spendAmount: 2,
          currency: "CAD",
        }),
      (error: unknown) => {
        const serialized = error instanceof Error
          ? `${error.message}\n${String((error as { cause?: unknown }).cause ?? "")}`
          : String(error);
        assert.match(serialized, /unique|duplicate|grain_uidx/i);
        return true;
      },
    );
    await db.delete(metaAdsAccountDaily).where(
      and(
        eq(metaAdsAccountDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID),
        eq(metaAdsAccountDaily.metricDate, DATE_UNPUBLISHED),
      ),
    );
    console.log("schema unique grain constraint PASS");

    const objectsClient = new FixtureMetaAdsClient(
      fullWindow(DATE_PUBLISHED, DATE_PUBLISHED),
    );
    const graphClient = objectsClient as unknown as MetaAdsClient;
    await importer.importAccountGraph(graphClient);

    const first = await importer.importInsights({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: graphClient,
    });
    assert.deepEqual(first.replacedDates, [DATE_PUBLISHED]);
    assert.equal(await dailyCount(db, metaAdsAccountDaily, DATE_PUBLISHED), 1);
    assert.equal(await dailyCount(db, metaAdsCampaignDaily, DATE_PUBLISHED), 1);
    assert.equal(await dailyCount(db, metaAdsAdSetDaily, DATE_PUBLISHED), 1);
    assert.equal(await dailyCount(db, metaAdsAdDaily, DATE_PUBLISHED), 1);
    assert.equal(await campaignSpend(db, DATE_PUBLISHED), 1234);
    const snapshotsAfterFirst = await db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.provider, META_ADS_PROVIDER));

    const second = await importer.importInsights({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: graphClient,
    });
    assert.deepEqual(second.replacedDates, [DATE_PUBLISHED]);
    const snapshotsAfterSecond = await db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.provider, META_ADS_PROVIDER));
    assert.equal(snapshotsAfterSecond.length, snapshotsAfterFirst.length);
    assert.equal(await dailyCount(db, metaAdsAccountDaily, DATE_PUBLISHED), 1);
    assert.equal(await campaignSpend(db, DATE_PUBLISHED), 1234);
    console.log("idempotent reimport PASS");

    const replacedSpend = fullWindow(DATE_PUBLISHED, DATE_PUBLISHED, "20.00");
    await importer.importInsights({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: new FixtureMetaAdsClient(replacedSpend) as unknown as MetaAdsClient,
    });
    const accountRows = await db
      .select({
        spendAmount: metaAdsAccountDaily.spendAmount,
        metricDate: metaAdsAccountDaily.metricDate,
      })
      .from(metaAdsAccountDaily)
      .where(eq(metaAdsAccountDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID));
    assert.equal(accountRows.length, 1);
    assert.equal(asDate(accountRows[0].metricDate), DATE_PUBLISHED);
    assert.equal(accountRows[0].spendAmount, 2000);
    assert.equal(await campaignSpend(db, DATE_PUBLISHED), 2000);
    console.log("per-level published replacement PASS");

    const twoDay = fullWindow(DATE_PUBLISHED, DATE_UNPUBLISHED, "20.00");
    const unpublishedWindow = await importer.importInsights({
      startDate: DATE_PUBLISHED,
      endDate: DATE_UNPUBLISHED,
      client: new FixtureMetaAdsClient(twoDay) as unknown as MetaAdsClient,
    });
    assert.deepEqual(unpublishedWindow.replacedDates, [DATE_PUBLISHED]);
    assert.ok(unpublishedWindow.possiblyUnpublishedDates.includes(DATE_UNPUBLISHED));
    assert.equal(await dailyCount(db, metaAdsCampaignDaily, DATE_UNPUBLISHED), 0);
    assert.equal(await dailyCount(db, metaAdsAccountDaily, DATE_UNPUBLISHED), 0);
    assert.equal(await campaignSpend(db, DATE_PUBLISHED), 2000);

    const incomplete = fullWindow(DATE_PUBLISHED, DATE_PUBLISHED, "20.00", []);
    const incompleteImport = await importer.importInsights({
      startDate: DATE_PUBLISHED,
      endDate: DATE_PUBLISHED,
      client: new FixtureMetaAdsClient(incomplete) as unknown as MetaAdsClient,
    });
    assert.equal(await campaignSpend(db, DATE_PUBLISHED), 2000);
    assert.equal(await dailyCount(db, metaAdsCampaignDaily, DATE_PUBLISHED), 1);
    const verdict = importer.reconcileImportedWindow(incompleteImport);
    assert.ok(
      verdict.diagnostics.some((line) =>
        line.includes(`campaign incomplete coverage date=${DATE_PUBLISHED}`),
      ),
    );
    const accountAfterIncomplete = await db
      .select({ spendAmount: metaAdsAccountDaily.spendAmount })
      .from(metaAdsAccountDaily)
      .where(eq(metaAdsAccountDaily.accountExternalId, META_ADS_CANONICAL_ACCOUNT_ID));
    assert.equal(accountAfterIncomplete[0]?.spendAmount, 2000);
    console.log("incomplete coverage protection PASS");

    await client.unsafe(`
      CREATE OR REPLACE FUNCTION meta_ads_phase_d_rollback_probe()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.ad_external_id = '${AD_ROLLBACK_ID}' THEN
          RAISE EXCEPTION 'synthetic_txn_rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS meta_ads_phase_d_rollback_probe_trg ON meta_ads_ad_daily;
      CREATE TRIGGER meta_ads_phase_d_rollback_probe_trg
      BEFORE INSERT ON meta_ads_ad_daily
      FOR EACH ROW EXECUTE FUNCTION meta_ads_phase_d_rollback_probe();
    `);
    const rollbackInsights = fullWindow(DATE_ROLLBACK, DATE_ROLLBACK, "3.00");
    rollbackInsights.ad = report("ad", DATE_ROLLBACK, DATE_ROLLBACK, [
      row(DATE_ROLLBACK, AD_ROLLBACK_ID, "3.00", {
        campaignId: CAMPAIGN_ID,
        adsetId: AD_SET_ID,
        adId: AD_ROLLBACK_ID,
      }),
    ]);
    await assert.rejects(
      () =>
        importer.importInsights({
          startDate: DATE_ROLLBACK,
          endDate: DATE_ROLLBACK,
          client: new FixtureMetaAdsClient(rollbackInsights) as unknown as MetaAdsClient,
        }),
      (error: unknown) => {
        assert.match(errorText(error), /synthetic_txn_rollback|SYN-META-D-AD-ROLLBACK/);
        return true;
      },
    );
    assert.equal(await dailyCount(db, metaAdsAccountDaily, DATE_ROLLBACK), 0);
    assert.equal(await dailyCount(db, metaAdsCampaignDaily, DATE_ROLLBACK), 0);
    assert.equal(await dailyCount(db, metaAdsAdSetDaily, DATE_ROLLBACK), 0);
    assert.equal(await dailyCount(db, metaAdsAdDaily, DATE_ROLLBACK), 0);
    assert.equal(await campaignSpend(db, DATE_PUBLISHED), 2000);
    console.log("transaction rollback PASS");

    const holder = postgres(env.databaseUrl, { max: 1, onnotice: () => undefined });
    const waiter = postgres(env.databaseUrl, { max: 1, onnotice: () => undefined });
    try {
      await withPostgresAdvisoryLock(
        holder as unknown as PostgresLockClient,
        META_ADS_IMPORT_LOCK_NAME,
        async () => {
        let ran = false;
        await assert.rejects(
          () =>
            withPostgresAdvisoryLock(
              waiter as unknown as PostgresLockClient,
              META_ADS_IMPORT_LOCK_NAME,
              async () => {
              ran = true;
            }),
          /advisory_lock_busy/,
        );
        assert.equal(ran, false);
        assert.equal(
          formatMetaAdsLockError("advisory_lock_busy"),
          "meta_ads_import_already_running",
        );
      });
    } finally {
      await holder.end({ timeout: 2 });
      await waiter.end({ timeout: 2 });
    }
    console.log("advisory lock PASS");

    await cleanupSynthetic(db, client);
    const leftover = await warehouseCounts(client);
    assert.equal(leftover.meta_snapshots, 0);
    assert.equal(leftover.meta_identities, 0);
    assert.equal(await dailyCount(db, metaAdsAccountDaily, DATE_PUBLISHED), 0);
    assert.equal(await dailyCount(db, metaAdsCampaignDaily, DATE_PUBLISHED), 0);
    await assertPreservedWarehouse(client);
    console.log("synthetic cleanup PASS");
    console.log("meta ads local database validation PASS");
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
