import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../database/database.service";
import { DatabaseService } from "../../database/database.service";
import { EnvService } from "../../config/env.service";
import {
  searchConsoleCountries,
  searchConsoleDailyTotals,
  searchConsoleDevices,
  searchConsolePages,
  searchConsoleProperties,
  searchConsoleQueries,
  searchConsoleSearchAppearances,
} from "../../database/schema/search-console";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { GoogleSearchConsoleClient } from "./google-search-console.client";
import {
  classifyGscWindowCoverage,
  factsForDates,
} from "./google-search-console.coverage";
import {
  GOOGLE_SEARCH_CONSOLE_PROVIDER,
  GSC_CANONICAL_SITE_URL,
  GSC_DATA_STATE,
  GSC_REPORT_ENTITY,
  GSC_SEARCH_TYPE,
  GSC_SITE_ENTITY,
} from "./google-search-console.constants";
import { hashCanonicalJson } from "./google-search-console.hash";
import { gscSiteExternalId } from "./google-search-console.identity";
import {
  normalizeReportPayload,
  type NormalizedGscFact,
} from "./google-search-console.normalize";
import { assertReportQuality } from "./google-search-console.quality";
import {
  evaluateGscWindowReconciliation,
  sumMetric,
  type GscFamilyReconcileTotals,
} from "./google-search-console.reconcile";
import { planGscFamilyReplacement } from "./google-search-console.replace";
import {
  GSC_REPORT_DEFINITIONS,
  type GscReportFamilyId,
  reportDefinition,
} from "./google-search-console.reports";
import {
  assertNoSecrets,
  reportSnapshotExternalId,
  sanitizeReportSnapshot,
  sanitizeSite,
} from "./google-search-console.sanitize";

export type GoogleSearchConsoleImportDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute" | "transaction"
>;

export type GscImportWindowResult = {
  siteUrl: string;
  families: GscFamilyReconcileTotals[];
  factsByFamily: Record<string, NormalizedGscFact[]>;
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  replacedDates: string[];
};

@Injectable()
export class GoogleSearchConsoleImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EnvService) private readonly env: EnvService,
  ) {}

  createClient(): GoogleSearchConsoleClient {
    const config = this.env.googleSearchConsole;
    if (!config) {
      throw new Error("google_search_console_not_configured");
    }
    if (config.siteUrl !== GSC_CANONICAL_SITE_URL) {
      throw new Error("gsc_site_url_not_canonical");
    }
    return new GoogleSearchConsoleClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      siteUrl: config.siteUrl,
    });
  }

  async importSiteConfig(
    client?: GoogleSearchConsoleClient,
  ): Promise<{
    siteUrl: string;
    permissionLevel: string | undefined;
  }> {
    const resolved = client ?? this.createClient();
    const db = this.database.db;
    const site = sanitizeSite(await resolved.getSite());
    assertNoSecrets(site);
    const siteUrl = requiredString(site.siteUrl, "gsc_site_url_missing");
    if (siteUrl !== GSC_CANONICAL_SITE_URL) {
      throw new Error("gsc_site_url_not_canonical");
    }
    const permissionLevel =
      typeof site.permissionLevel === "string" ? site.permissionLevel : undefined;
    const snapshotId = await this.persistSnapshot(
      db,
      GSC_SITE_ENTITY,
      gscSiteExternalId(siteUrl),
      site,
    );
    const existing = await db
      .select({ id: searchConsoleProperties.id })
      .from(searchConsoleProperties)
      .where(eq(searchConsoleProperties.siteUrl, siteUrl))
      .limit(1);
    if (existing[0]) {
      await db
        .update(searchConsoleProperties)
        .set({
          permissionLevel: permissionLevel ?? null,
          sourceSnapshotId: snapshotId,
          updatedAt: new Date(),
        })
        .where(eq(searchConsoleProperties.id, existing[0].id));
    } else {
      await db.insert(searchConsoleProperties).values({
        siteUrl,
        permissionLevel: permissionLevel ?? null,
        sourceSnapshotId: snapshotId,
      });
    }
    return { siteUrl, permissionLevel };
  }

  async importReports(options: {
    startDate: string;
    endDate: string;
    client?: GoogleSearchConsoleClient;
    families?: readonly GscReportFamilyId[];
  }): Promise<GscImportWindowResult> {
    const families =
      options.families ?? GSC_REPORT_DEFINITIONS.map((item) => item.id);
    const client = options.client ?? this.createClient();
    const siteUrl = client.siteUrl;
    const db = this.database.db;
    const fetched: Array<{
      family: GscReportFamilyId;
      report: Awaited<ReturnType<GoogleSearchConsoleClient["runFamilyReport"]>>;
      snapshot: Record<string, unknown>;
      facts: NormalizedGscFact[];
    }> = [];

    for (const family of families) {
      const definition = reportDefinition(family);
      const report = await client.runFamilyReport(
        definition,
        options.startDate,
        options.endDate,
      );
      assertReportQuality(report);
      const snapshot = sanitizeReportSnapshot(report);
      assertNoSecrets(snapshot);
      const facts = normalizeReportPayload(snapshot);
      fetched.push({ family: definition.id, report, snapshot, facts });
    }

    const factsByFamily: Record<string, NormalizedGscFact[]> = {};
    for (const item of fetched) {
      factsByFamily[item.family] = item.facts;
    }
    const coverage = classifyGscWindowCoverage({
      from: options.startDate,
      to: options.endDate,
      factsByFamily,
    });

    const results: GscFamilyReconcileTotals[] = [];
    for (const item of fetched) {
      const snapshotId = await this.persistSnapshot(
        db,
        GSC_REPORT_ENTITY,
        reportSnapshotExternalId(
          siteUrl,
          item.family,
          options.startDate,
          options.endDate,
        ),
        item.snapshot,
      );
      const plan = planGscFamilyReplacement({
        family: item.family,
        siteUrl,
        publishedDates: coverage.publishedDates,
        possiblyUnpublishedDates: coverage.possiblyUnpublishedDates,
      });
      await db.transaction(async (tx) => {
        await this.replaceFamily(
          tx,
          item.family,
          siteUrl,
          snapshotId,
          factsForDates(item.facts, plan.replaceDates),
          plan.replaceDates,
        );
      });
      results.push({
        family: item.family,
        startDate: options.startDate,
        endDate: options.endDate,
        sourceRows: item.facts.length,
        providerRowCount: item.report.rowCount,
        canonicalRows: item.facts.length,
        unresolvedRows: 0,
        requestCount: item.report.requestCount,
        dataState: GSC_DATA_STATE,
        searchType: GSC_SEARCH_TYPE,
      });
    }

    return {
      siteUrl,
      families: results,
      factsByFamily,
      publishedDates: coverage.publishedDates,
      possiblyUnpublishedDates: coverage.possiblyUnpublishedDates,
      replacedDates: coverage.publishedDates,
    };
  }

  reconcileImportedWindow(imported: GscImportWindowResult) {
    return evaluateGscWindowReconciliation({
      rangeLabel: `${imported.families[0]?.startDate ?? ""}/${imported.families[0]?.endDate ?? ""}`,
      families: imported.families,
      publishedDates: imported.publishedDates,
      possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
      dailyClicks: sumMetric(imported.factsByFamily.daily_totals, "clicks"),
      dailyImpressions: sumMetric(imported.factsByFamily.daily_totals, "impressions"),
      queryClicks: sumMetric(imported.factsByFamily.query, "clicks"),
      queryImpressions: sumMetric(imported.factsByFamily.query, "impressions"),
      pageClicks: sumMetric(imported.factsByFamily.page, "clicks"),
      pageImpressions: sumMetric(imported.factsByFamily.page, "impressions"),
      countryClicks: sumMetric(imported.factsByFamily.country, "clicks"),
      countryImpressions: sumMetric(imported.factsByFamily.country, "impressions"),
      deviceClicks: sumMetric(imported.factsByFamily.device, "clicks"),
      deviceImpressions: sumMetric(imported.factsByFamily.device, "impressions"),
      searchAppearanceClicks: sumMetric(
        imported.factsByFamily.search_appearance,
        "clicks",
      ),
      searchAppearanceImpressions: sumMetric(
        imported.factsByFamily.search_appearance,
        "impressions",
      ),
    });
  }

  private async persistSnapshot(
    db: GoogleSearchConsoleImportDb,
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
          eq(sourceSnapshots.provider, GOOGLE_SEARCH_CONSOLE_PROVIDER),
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
        provider: GOOGLE_SEARCH_CONSOLE_PROVIDER,
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
    db: GoogleSearchConsoleImportDb,
    entityType: string,
    externalId: string,
  ): Promise<void> {
    const existing = await db
      .select({ id: sourceIdentities.id })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, GOOGLE_SEARCH_CONSOLE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return;
    }
    await db.insert(sourceIdentities).values({
      provider: GOOGLE_SEARCH_CONSOLE_PROVIDER,
      entityType,
      externalId,
    });
  }

  private async replaceFamily(
    db: Pick<AppDatabase, "insert" | "delete">,
    family: GscReportFamilyId,
    siteUrl: string,
    sourceSnapshotId: string,
    facts: NormalizedGscFact[],
    replaceDates: readonly string[],
  ): Promise<void> {
    if (replaceDates.length === 0) {
      return;
    }
    const metrics = (fact: NormalizedGscFact) => ({
      clicks: fact.metrics.clicks,
      impressions: fact.metrics.impressions,
      ctr: fact.metrics.ctr,
      position: fact.metrics.position,
      sourceSnapshotId,
    });

    if (family === "daily_totals") {
      await db
        .delete(searchConsoleDailyTotals)
        .where(
          and(
            eq(searchConsoleDailyTotals.siteUrl, siteUrl),
            inArray(searchConsoleDailyTotals.gscDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(searchConsoleDailyTotals).values({
          siteUrl,
          gscDate: fact.gscDate,
          ...metrics(fact),
        });
      }
      return;
    }
    if (family === "query") {
      await db
        .delete(searchConsoleQueries)
        .where(
          and(
            eq(searchConsoleQueries.siteUrl, siteUrl),
            inArray(searchConsoleQueries.gscDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(searchConsoleQueries).values({
          siteUrl,
          gscDate: fact.gscDate,
          query: fact.dimensions.query,
          ...metrics(fact),
        });
      }
      return;
    }
    if (family === "page") {
      await db
        .delete(searchConsolePages)
        .where(
          and(
            eq(searchConsolePages.siteUrl, siteUrl),
            inArray(searchConsolePages.gscDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(searchConsolePages).values({
          siteUrl,
          gscDate: fact.gscDate,
          page: fact.dimensions.page,
          ...metrics(fact),
        });
      }
      return;
    }
    if (family === "country") {
      await db
        .delete(searchConsoleCountries)
        .where(
          and(
            eq(searchConsoleCountries.siteUrl, siteUrl),
            inArray(searchConsoleCountries.gscDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(searchConsoleCountries).values({
          siteUrl,
          gscDate: fact.gscDate,
          country: fact.dimensions.country,
          ...metrics(fact),
        });
      }
      return;
    }
    if (family === "device") {
      await db
        .delete(searchConsoleDevices)
        .where(
          and(
            eq(searchConsoleDevices.siteUrl, siteUrl),
            inArray(searchConsoleDevices.gscDate, [...replaceDates]),
          ),
        );
      for (const fact of facts) {
        await db.insert(searchConsoleDevices).values({
          siteUrl,
          gscDate: fact.gscDate,
          device: fact.dimensions.device,
          ...metrics(fact),
        });
      }
      return;
    }
    await db
      .delete(searchConsoleSearchAppearances)
      .where(
        and(
          eq(searchConsoleSearchAppearances.siteUrl, siteUrl),
          inArray(searchConsoleSearchAppearances.gscDate, [...replaceDates]),
        ),
      );
    for (const fact of facts) {
      await db.insert(searchConsoleSearchAppearances).values({
        siteUrl,
        gscDate: fact.gscDate,
        searchAppearance: fact.dimensions.searchAppearance,
        ...metrics(fact),
      });
    }
  }
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(error);
  }
  return value;
}
