import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../database/database.service";
import { DatabaseService } from "../../database/database.service";
import { EnvService } from "../../config/env.service";
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
import { MetaAdsClient } from "./meta-ads.client";
import {
  META_ADS_ACCOUNT_ENTITY,
  META_ADS_AD_ENTITY,
  META_ADS_AD_SET_ENTITY,
  META_ADS_ATTRIBUTION_WINDOW_ID,
  META_ADS_CAMPAIGN_ENTITY,
  META_ADS_CANONICAL_ACCOUNT_ID,
  META_ADS_CANONICAL_CURRENCY,
  META_ADS_INSIGHT_ENTITY,
  META_ADS_PROVIDER,
  META_ADS_REPORTING_TIME_ZONE,
} from "./meta-ads.constants";
import {
  classifyMetaAdsWindowCoverage,
  factsForDates,
  incompleteLevelCoverageDiagnostics,
  publishedDatesForFacts,
} from "./meta-ads.coverage";
import { hashCanonicalJson } from "./meta-ads.hash";
import {
  metaAdsAccountExternalId,
  metaAdsObjectExternalId,
} from "./meta-ads.identity";
import { parseCountString } from "./meta-ads.money";
import {
  normalizeInsightPayload,
  type NormalizedMetaAdsFact,
} from "./meta-ads.normalize";
import { assertInsightQuality } from "./meta-ads.quality";
import {
  evaluateMetaAdsWindowReconciliation,
  sumSpend,
  type MetaAdsLevelReconcileTotals,
} from "./meta-ads.reconcile";
import { planMetaAdsFamilyReplacement } from "./meta-ads.replace";
import { metaAdsDatesInclusive } from "./meta-ads.range";
import { META_ADS_INSIGHT_LEVELS } from "./meta-ads.reports";
import {
  assertNoSecrets,
  insightSnapshotExternalId,
  sanitizeAccount,
  sanitizeAd,
  sanitizeAdSet,
  sanitizeCampaign,
  sanitizeInsightSnapshot,
} from "./meta-ads.sanitize";
import type { MetaAdsInsightLevel, MetaAdsJson } from "./meta-ads.types";

export type MetaAdsImportDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute" | "transaction"
>;

export type MetaAdsImportWindowResult = {
  accountId: string;
  levels: MetaAdsLevelReconcileTotals[];
  factsByLevel: Record<string, NormalizedMetaAdsFact[]>;
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  replacedDates: string[];
  replacedDatesByLevel: Record<string, string[]>;
};

@Injectable()
export class MetaAdsImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EnvService) private readonly env: EnvService,
  ) {}

  createClient(): MetaAdsClient {
    const config = this.env.metaAds;
    if (!config) {
      throw new Error("meta_ads_not_configured");
    }
    return new MetaAdsClient({
      accessToken: config.accessToken,
      accountId: config.accountId,
    });
  }

  async importAccountGraph(
    client?: MetaAdsClient,
  ): Promise<{ accountId: string; name: string | undefined }> {
    const resolved = client ?? this.createClient();
    const db = this.database.db;
    const account = sanitizeAccount(await resolved.getAccount());
    assertNoSecrets(account);
    const accountId = canonicalAccountId(account);
    const currency = requiredString(account.currency, "meta_ads_currency_missing");
    const timezone = requiredString(
      account.timezone_name,
      "meta_ads_timezone_missing",
    );
    assertInsightQuality({
      attributionWindow: META_ADS_ATTRIBUTION_WINDOW_ID,
      currency,
      timezone,
    });
    const name = optionalString(account.name);
    const accountStatus = optionalString(account.account_status);
    const snapshotId = await this.persistSnapshot(
      db,
      META_ADS_ACCOUNT_ENTITY,
      metaAdsAccountExternalId(accountId),
      account,
    );
    await this.upsertAccount(db, {
      accountId,
      name,
      currency,
      timezone,
      accountStatus,
      snapshotId,
    });

    await this.importCurrentObjects(
      db,
      META_ADS_CAMPAIGN_ENTITY,
      () => resolved.listCampaigns(),
      sanitizeCampaign,
      (item) => this.upsertCampaign(db, item, accountId),
    );
    await this.importCurrentObjects(
      db,
      META_ADS_AD_SET_ENTITY,
      () => resolved.listAdSets(),
      sanitizeAdSet,
      (item) => this.upsertAdSet(db, item, accountId),
    );
    await this.importCurrentObjects(
      db,
      META_ADS_AD_ENTITY,
      () => resolved.listAds(),
      sanitizeAd,
      (item) => this.upsertAd(db, item, accountId),
    );

    return { accountId, name };
  }

  async importInsights(options: {
    startDate: string;
    endDate: string;
    client?: MetaAdsClient;
    levels?: readonly MetaAdsInsightLevel[];
  }): Promise<MetaAdsImportWindowResult> {
    const levels = options.levels ?? META_ADS_INSIGHT_LEVELS;
    const client = options.client ?? this.createClient();
    const accountId = client.accountId;
    const db = this.database.db;
    const fetched: Array<{
      level: MetaAdsInsightLevel;
      report: Awaited<ReturnType<MetaAdsClient["listInsights"]>>;
      snapshot: Record<string, unknown>;
      facts: NormalizedMetaAdsFact[];
    }> = [];

    for (const level of levels) {
      const report = await client.listInsights({
        level,
        startDate: options.startDate,
        endDate: options.endDate,
      });
      assertInsightQuality({
        attributionWindow: report.attributionWindow,
        currency: META_ADS_CANONICAL_CURRENCY,
        timezone: META_ADS_REPORTING_TIME_ZONE,
      });
      const snapshot = sanitizeInsightSnapshot(report);
      assertNoSecrets(snapshot);
      const facts = normalizeInsightPayload(snapshot);
      fetched.push({ level, report, snapshot, facts });
    }

    if (fetched.length !== levels.length) {
      throw new Error("meta_ads_partial_insight_levels");
    }

    const factsByLevel: Record<string, NormalizedMetaAdsFact[]> = {};
    for (const item of fetched) {
      factsByLevel[item.level] = item.facts;
    }
    const coverage = classifyMetaAdsWindowCoverage({
      from: options.startDate,
      to: options.endDate,
      factsByLevel,
    });
    const replacedDatesByLevel: Record<string, string[]> = {};
    const results: MetaAdsLevelReconcileTotals[] = [];

    await db.transaction(async (tx) => {
      for (const item of fetched) {
        const snapshotId = await this.persistSnapshot(
          tx,
          META_ADS_INSIGHT_ENTITY,
          insightSnapshotExternalId(
            accountId,
            item.level,
            options.startDate,
            options.endDate,
          ),
          item.snapshot,
        );
        const levelPublished = publishedDatesForFacts(item.facts);
        const plan = planMetaAdsFamilyReplacement({
          level: item.level,
          accountId,
          publishedDates: levelPublished,
          possiblyUnpublishedDates: metaAdsDatesInclusive(
            options.startDate,
            options.endDate,
          ).filter((date) => !levelPublished.includes(date)),
        });
        replacedDatesByLevel[item.level] = plan.replaceDates;
        await this.replaceLevel(
          tx,
          item.level,
          accountId,
          snapshotId,
          factsForDates(item.facts, plan.replaceDates),
          plan.replaceDates,
        );
        results.push({
          level: item.level,
          startDate: options.startDate,
          endDate: options.endDate,
          sourceRows: item.facts.length,
          providerRowCount: item.report.rowCount,
          canonicalRows: item.facts.length,
          unresolvedRows: 0,
          requestCount: item.report.requestCount,
          attributionWindow: item.report.attributionWindow,
        });
      }
    });

    const replacedDates = [
      ...new Set(Object.values(replacedDatesByLevel).flat()),
    ].sort();

    return {
      accountId,
      levels: results,
      factsByLevel,
      publishedDates: coverage.publishedDates,
      possiblyUnpublishedDates: coverage.possiblyUnpublishedDates,
      replacedDates,
      replacedDatesByLevel,
    };
  }

  reconcileImportedWindow(imported: MetaAdsImportWindowResult) {
    const verdict = evaluateMetaAdsWindowReconciliation({
      rangeLabel: `${imported.levels[0]?.startDate ?? ""}/${imported.levels[0]?.endDate ?? ""}`,
      levels: imported.levels,
      publishedDates: imported.publishedDates,
      possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
      accountSpend: sumSpend(imported.factsByLevel.account),
      campaignSpend: sumSpend(imported.factsByLevel.campaign),
      adsetSpend: sumSpend(imported.factsByLevel.adset),
      adSpend: sumSpend(imported.factsByLevel.ad),
    });
    return {
      ...verdict,
      diagnostics: [
        ...verdict.diagnostics,
        ...incompleteLevelCoverageDiagnostics(imported.factsByLevel),
      ],
    };
  }

  private async importCurrentObjects(
    db: MetaAdsImportDb,
    entityType: string,
    list: () => Promise<{ items: MetaAdsJson[] }>,
    sanitize: (payload: MetaAdsJson) => Record<string, unknown>,
    upsert: (item: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    const page = await list();
    for (const raw of page.items) {
      const item = sanitize(raw);
      assertNoSecrets(item);
      const objectId = requiredString(item.id, "meta_ads_object_id_missing");
      const snapshotId = await this.persistSnapshot(
        db,
        entityType,
        metaAdsObjectExternalId(META_ADS_CANONICAL_ACCOUNT_ID, entityType, objectId),
        item,
      );
      await upsert({ ...item, sourceSnapshotId: snapshotId });
    }
  }

  private async persistSnapshot(
    db: MetaAdsImportDb,
    entityType: string,
    externalId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const payloadHash = hashCanonicalJson(payload);
    const existing = await db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, META_ADS_PROVIDER),
          eq(sourceSnapshots.entityType, entityType),
          eq(sourceSnapshots.externalId, externalId),
          eq(sourceSnapshots.payloadHash, payloadHash),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.upsertIdentity(db, entityType, externalId);
      return existing[0].id;
    }
    const inserted = await db
      .insert(sourceSnapshots)
      .values({
        provider: META_ADS_PROVIDER,
        entityType,
        externalId,
        observedAt: new Date(),
        payloadHash,
        payload,
      })
      .returning({ id: sourceSnapshots.id });
    await this.upsertIdentity(db, entityType, externalId);
    return inserted[0].id;
  }

  private async upsertIdentity(
    db: MetaAdsImportDb,
    entityType: string,
    externalId: string,
  ): Promise<void> {
    const existing = await db
      .select({ id: sourceIdentities.id })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, META_ADS_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return;
    }
    await db.insert(sourceIdentities).values({
      provider: META_ADS_PROVIDER,
      entityType,
      externalId,
    });
  }

  private async upsertAccount(
    db: MetaAdsImportDb,
    input: {
      accountId: string;
      name?: string;
      currency: string;
      timezone: string;
      accountStatus?: string;
      snapshotId: string;
    },
  ): Promise<void> {
    const existing = await db
      .select({ id: metaAdsAccounts.id })
      .from(metaAdsAccounts)
      .where(eq(metaAdsAccounts.accountExternalId, input.accountId))
      .limit(1);
    const values = {
      name: input.name ?? null,
      currency: input.currency,
      timezoneName: input.timezone,
      accountStatus: input.accountStatus ?? null,
      sourceSnapshotId: input.snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(metaAdsAccounts)
        .set(values)
        .where(eq(metaAdsAccounts.id, existing[0].id));
      return;
    }
    await db.insert(metaAdsAccounts).values({
      accountExternalId: input.accountId,
      ...values,
    });
  }

  private async upsertCampaign(
    db: MetaAdsImportDb,
    item: Record<string, unknown>,
    accountId: string,
  ): Promise<void> {
    const campaignExternalId = requiredString(item.id, "meta_ads_object_id_missing");
    const snapshotId = requiredString(
      item.sourceSnapshotId,
      "meta_ads_snapshot_missing",
    );
    const existing = await db
      .select({ id: metaAdsCampaigns.id })
      .from(metaAdsCampaigns)
      .where(
        and(
          eq(metaAdsCampaigns.accountExternalId, accountId),
          eq(metaAdsCampaigns.campaignExternalId, campaignExternalId),
        ),
      )
      .limit(1);
    const values = {
      name: optionalString(item.name) ?? null,
      status: optionalString(item.status) ?? null,
      effectiveStatus: optionalString(item.effective_status) ?? null,
      objective: optionalString(item.objective) ?? null,
      sourceSnapshotId: snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(metaAdsCampaigns)
        .set(values)
        .where(eq(metaAdsCampaigns.id, existing[0].id));
      return;
    }
    await db.insert(metaAdsCampaigns).values({
      accountExternalId: accountId,
      campaignExternalId,
      ...values,
    });
  }

  private async upsertAdSet(
    db: MetaAdsImportDb,
    item: Record<string, unknown>,
    accountId: string,
  ): Promise<void> {
    const adSetExternalId = requiredString(item.id, "meta_ads_object_id_missing");
    const snapshotId = requiredString(
      item.sourceSnapshotId,
      "meta_ads_snapshot_missing",
    );
    const existing = await db
      .select({ id: metaAdsAdSets.id })
      .from(metaAdsAdSets)
      .where(
        and(
          eq(metaAdsAdSets.accountExternalId, accountId),
          eq(metaAdsAdSets.adSetExternalId, adSetExternalId),
        ),
      )
      .limit(1);
    const values = {
      campaignExternalId: optionalString(item.campaign_id) ?? null,
      name: optionalString(item.name) ?? null,
      status: optionalString(item.status) ?? null,
      effectiveStatus: optionalString(item.effective_status) ?? null,
      sourceSnapshotId: snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(metaAdsAdSets)
        .set(values)
        .where(eq(metaAdsAdSets.id, existing[0].id));
      return;
    }
    await db.insert(metaAdsAdSets).values({
      accountExternalId: accountId,
      adSetExternalId,
      ...values,
    });
  }

  private async upsertAd(
    db: MetaAdsImportDb,
    item: Record<string, unknown>,
    accountId: string,
  ): Promise<void> {
    const adExternalId = requiredString(item.id, "meta_ads_object_id_missing");
    const snapshotId = requiredString(
      item.sourceSnapshotId,
      "meta_ads_snapshot_missing",
    );
    const existing = await db
      .select({ id: metaAdsAds.id })
      .from(metaAdsAds)
      .where(
        and(
          eq(metaAdsAds.accountExternalId, accountId),
          eq(metaAdsAds.adExternalId, adExternalId),
        ),
      )
      .limit(1);
    const values = {
      adSetExternalId: optionalString(item.adset_id) ?? null,
      campaignExternalId: optionalString(item.campaign_id) ?? null,
      name: optionalString(item.name) ?? null,
      status: optionalString(item.status) ?? null,
      effectiveStatus: optionalString(item.effective_status) ?? null,
      sourceSnapshotId: snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(metaAdsAds)
        .set(values)
        .where(eq(metaAdsAds.id, existing[0].id));
      return;
    }
    await db.insert(metaAdsAds).values({
      accountExternalId: accountId,
      adExternalId,
      ...values,
    });
  }

  private async replaceLevel(
    db: Pick<AppDatabase, "insert" | "delete">,
    level: MetaAdsInsightLevel,
    accountId: string,
    sourceSnapshotId: string,
    facts: NormalizedMetaAdsFact[],
    replaceDates: readonly string[],
  ): Promise<void> {
    if (replaceDates.length === 0) {
      return;
    }
    const metrics = (fact: NormalizedMetaAdsFact) => ({
      metricDate: fact.metricDate,
      attributionWindow: fact.attributionWindow,
      spendAmount: fact.spendAmount,
      currency: fact.currency,
      impressions: parseCountString(fact.impressions),
      clicks: parseCountString(fact.clicks),
      reach: fact.reach ? parseCountString(fact.reach) : null,
      frequency: fact.frequency ?? null,
      cpc: fact.cpc ?? null,
      cpm: fact.cpm ?? null,
      ctr: fact.ctr ?? null,
      sourceSnapshotId,
    });

    if (level === "account") {
      await db
        .delete(metaAdsAccountDaily)
        .where(
          and(
            eq(metaAdsAccountDaily.accountExternalId, accountId),
            eq(metaAdsAccountDaily.attributionWindow, META_ADS_ATTRIBUTION_WINDOW_ID),
            inArray(metaAdsAccountDaily.metricDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(metaAdsAccountDaily).values({
          accountExternalId: accountId,
          ...metrics(fact),
        });
      }
      return;
    }
    if (level === "campaign") {
      await db
        .delete(metaAdsCampaignDaily)
        .where(
          and(
            eq(metaAdsCampaignDaily.accountExternalId, accountId),
            eq(metaAdsCampaignDaily.attributionWindow, META_ADS_ATTRIBUTION_WINDOW_ID),
            inArray(metaAdsCampaignDaily.metricDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(metaAdsCampaignDaily).values({
          accountExternalId: accountId,
          campaignExternalId: fact.objectId,
          ...metrics(fact),
        });
      }
      return;
    }
    if (level === "adset") {
      await db
        .delete(metaAdsAdSetDaily)
        .where(
          and(
            eq(metaAdsAdSetDaily.accountExternalId, accountId),
            eq(metaAdsAdSetDaily.attributionWindow, META_ADS_ATTRIBUTION_WINDOW_ID),
            inArray(metaAdsAdSetDaily.metricDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(metaAdsAdSetDaily).values({
          accountExternalId: accountId,
          adSetExternalId: fact.objectId,
          campaignExternalId: fact.campaignId ?? null,
          ...metrics(fact),
        });
      }
      return;
    }
    await db
      .delete(metaAdsAdDaily)
      .where(
        and(
          eq(metaAdsAdDaily.accountExternalId, accountId),
          eq(metaAdsAdDaily.attributionWindow, META_ADS_ATTRIBUTION_WINDOW_ID),
          inArray(metaAdsAdDaily.metricDate, [...replaceDates]),
        ),
      );
    for (const fact of facts) {
      await db.insert(metaAdsAdDaily).values({
        accountExternalId: accountId,
        adExternalId: fact.objectId,
        adSetExternalId: fact.adsetId ?? null,
        campaignExternalId: fact.campaignId ?? null,
        ...metrics(fact),
      });
    }
  }
}

function canonicalAccountId(account: Record<string, unknown>): string {
  const raw = optionalString(account.id) ?? optionalString(account.account_id);
  if (!raw) {
    throw new Error("meta_ads_account_id_missing");
  }
  const withPrefix = raw.startsWith("act_") ? raw : `act_${raw}`;
  if (withPrefix !== META_ADS_CANONICAL_ACCOUNT_ID) {
    throw new Error("meta_ads_account_id_not_canonical");
  }
  return META_ADS_CANONICAL_ACCOUNT_ID;
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(error);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
