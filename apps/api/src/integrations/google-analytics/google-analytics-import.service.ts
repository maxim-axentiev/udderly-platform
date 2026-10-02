import { Injectable } from "@nestjs/common";
import { and, eq, gte, lte } from "drizzle-orm";
import type { AppDatabase } from "../../database/database.service";
import { DatabaseService } from "../../database/database.service";
import { EnvService } from "../../config/env.service";
import {
  analyticsCountries,
  analyticsDailyTotals,
  analyticsDevices,
  analyticsEcommerceItems,
  analyticsEvents,
  analyticsFirstUserAcquisition,
  analyticsKeyEvents,
  analyticsLandingPages,
  analyticsPagePaths,
  analyticsProperties,
  analyticsSessionAcquisition,
} from "../../database/schema/analytics";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { GoogleAnalyticsClient } from "./google-analytics.client";
import {
  GA_ADS_LINK_ENTITY,
  GA_ATTRIBUTION_ENTITY,
  GA_CUSTOM_DIMENSION_ENTITY,
  GA_CUSTOM_METRIC_ENTITY,
  GA_IDENTITY_ENTITY,
  GA_KEY_EVENT_ENTITY,
  GA_PROPERTY_ENTITY,
  GA_REPORT_ENTITY,
  GA_RETENTION_ENTITY,
  GA_STREAM_ENTITY,
  GOOGLE_ANALYTICS_PROVIDER,
} from "./google-analytics.constants";
import { hashCanonicalJson } from "./google-analytics.hash";
import { gaAdminExternalId, gaScopedExternalId } from "./google-analytics.identity";
import {
  DAILY_COMPONENT_SNAPSHOT_FIELD,
  isGaDailyComponentId,
  type GaDailyComponentId,
} from "./google-analytics.daily";
import {
  normalizeReportPayload,
  type NormalizedFact,
} from "./google-analytics.normalize";
import { qualityFailure } from "./google-analytics.quality";
import type { GaFamilyReconcileTotals } from "./google-analytics.reconcile";
import {
  evaluateGaWindowReconciliation,
  sumMetric,
} from "./google-analytics.reconcile";
import {
  GA_REPORT_DEFINITIONS,
  type GaReportFamilyId,
  reportDefinition,
} from "./google-analytics.reports";
import {
  assertNoSecrets,
  reportSnapshotExternalId,
  sanitizeAdsLink,
  sanitizeAttribution,
  sanitizeCustomDimension,
  sanitizeCustomMetric,
  sanitizeKeyEvent,
  sanitizeProperty,
  sanitizeReportSnapshot,
  sanitizeReportingIdentity,
  sanitizeRetention,
  sanitizeStream,
} from "./google-analytics.sanitize";
import type { GoogleAnalyticsJson } from "./google-analytics.types";

export type GoogleAnalyticsImportDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "execute"
>;

export type GaImportWindowResult = {
  propertyId: string;
  families: GaFamilyReconcileTotals[];
  factsByFamily: Record<string, NormalizedFact[]>;
};

@Injectable()
export class GoogleAnalyticsImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly env: EnvService,
  ) {}

  createClient(): GoogleAnalyticsClient {
    const config = this.env.googleAnalytics;
    if (!config) {
      throw new Error("google_analytics_not_configured");
    }
    return new GoogleAnalyticsClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      propertyId: config.propertyId,
    });
  }

  async importAdminConfig(client = this.createClient()): Promise<{
    propertyId: string;
    timezone: string;
    currency: string;
  }> {
    const db = this.database.db;
    const property = sanitizeProperty(await client.getProperty());
    assertNoSecrets(property);
    const propertyId = client.propertyId;
    const timezone = requiredString(property.timeZone, "property_timezone_missing");
    const currency = requiredString(property.currencyCode, "property_currency_missing");
    const propertySnapshotId = await this.persistSnapshot(
      db,
      GA_PROPERTY_ENTITY,
      gaAdminExternalId(propertyId),
      property,
    );
    await this.upsertIdentity(db, GA_PROPERTY_ENTITY, gaAdminExternalId(propertyId));

    const retention = sanitizeRetention(await client.getDataRetentionSettings());
    assertNoSecrets(retention);
    await this.persistSnapshot(
      db,
      GA_RETENTION_ENTITY,
      gaAdminExternalId(propertyId),
      retention,
    );

    const streamsPayload = await client.listDataStreams();
    const streams = listItems(streamsPayload, "dataStreams");
    const web = streams.find((stream) => stream.type === "WEB_DATA_STREAM");
    const sanitizedStream = web ? sanitizeStream(web) : undefined;
    if (sanitizedStream) {
      assertNoSecrets(sanitizedStream);
      await this.persistSnapshot(
        db,
        GA_STREAM_ENTITY,
        gaScopedExternalId(propertyId, streamExternalId(sanitizedStream)),
        sanitizedStream,
      );
    }

    const attribution = sanitizeAttribution(await client.getAttributionSettings());
    assertNoSecrets(attribution);
    await this.persistSnapshot(
      db,
      GA_ATTRIBUTION_ENTITY,
      gaAdminExternalId(propertyId),
      attribution,
    );

    const identity = sanitizeReportingIdentity(
      await client.getReportingIdentitySettings(),
    );
    assertNoSecrets(identity);
    await this.persistSnapshot(db, GA_IDENTITY_ENTITY, gaAdminExternalId(propertyId), identity);

    const adsLinks = listItems(await client.listGoogleAdsLinks(), "googleAdsLinks");
    let adsCustomerId: string | null = null;
    for (const link of adsLinks) {
      const sanitized = sanitizeAdsLink(link);
      assertNoSecrets(sanitized);
      const customerId = String(sanitized.customerId ?? "unknown");
      adsCustomerId = adsCustomerId ?? customerId;
      await this.persistSnapshot(
        db,
        GA_ADS_LINK_ENTITY,
        gaScopedExternalId(propertyId, customerId),
        sanitized,
      );
    }

    await db
      .insert(analyticsProperties)
      .values({
        propertyExternalId: propertyId,
        displayName: String(property.displayName ?? ""),
        timeZone: timezone,
        currencyCode: currency,
        industryCategory: optionalString(property.industryCategory),
        serviceLevel: optionalString(property.serviceLevel),
        propertyType: optionalString(property.propertyType),
        accountExternalId: accountExternalId(property),
        createTime: optionalDate(property.createTime),
        updateTime: optionalDate(property.updateTime),
        eventDataRetention: optionalString(retention.eventDataRetention),
        userDataRetention: optionalString(retention.userDataRetention),
        resetUserDataOnNewActivity:
          retention.resetUserDataOnNewActivity === undefined
            ? null
            : String(retention.resetUserDataOnNewActivity),
        reportingIdentity: optionalString(identity.reportingIdentity),
        acquisitionLookback: optionalString(
          attribution.acquisitionConversionEventLookbackWindow,
        ),
        otherConversionLookback: optionalString(
          attribution.otherConversionEventLookbackWindow,
        ),
        reportingAttributionModel: optionalString(
          attribution.reportingAttributionModel,
        ),
        adsWebConversionExportScope: optionalString(
          attribution.adsWebConversionDataExportScope,
        ),
        streamExternalId: sanitizedStream
          ? streamExternalId(sanitizedStream)
          : null,
        streamDisplayName: sanitizedStream
          ? optionalString(sanitizedStream.displayName)
          : null,
        streamType: sanitizedStream ? optionalString(sanitizedStream.type) : null,
        measurementId: webMeasurement(sanitizedStream, "measurementId"),
        defaultUri: webMeasurement(sanitizedStream, "defaultUri"),
        sourceSnapshotId: propertySnapshotId,
      })
      .onConflictDoUpdate({
        target: analyticsProperties.propertyExternalId,
        set: {
          displayName: String(property.displayName ?? ""),
          timeZone: timezone,
          currencyCode: currency,
          industryCategory: optionalString(property.industryCategory),
          serviceLevel: optionalString(property.serviceLevel),
          propertyType: optionalString(property.propertyType),
          accountExternalId: accountExternalId(property),
          createTime: optionalDate(property.createTime),
          updateTime: optionalDate(property.updateTime),
          eventDataRetention: optionalString(retention.eventDataRetention),
          userDataRetention: optionalString(retention.userDataRetention),
          resetUserDataOnNewActivity:
            retention.resetUserDataOnNewActivity === undefined
              ? null
              : String(retention.resetUserDataOnNewActivity),
          reportingIdentity: optionalString(identity.reportingIdentity),
          acquisitionLookback: optionalString(
            attribution.acquisitionConversionEventLookbackWindow,
          ),
          otherConversionLookback: optionalString(
            attribution.otherConversionEventLookbackWindow,
          ),
          reportingAttributionModel: optionalString(
            attribution.reportingAttributionModel,
          ),
          adsWebConversionExportScope: optionalString(
            attribution.adsWebConversionDataExportScope,
          ),
          streamExternalId: sanitizedStream
            ? streamExternalId(sanitizedStream)
            : null,
          streamDisplayName: sanitizedStream
            ? optionalString(sanitizedStream.displayName)
            : null,
          streamType: sanitizedStream ? optionalString(sanitizedStream.type) : null,
          measurementId: webMeasurement(sanitizedStream, "measurementId"),
          defaultUri: webMeasurement(sanitizedStream, "defaultUri"),
          sourceSnapshotId: propertySnapshotId,
          updatedAt: new Date(),
        },
      });

    for (const event of listItems(await client.listKeyEvents(), "keyEvents")) {
      const sanitized = sanitizeKeyEvent(event);
      assertNoSecrets(sanitized);
      const eventName = requiredString(sanitized.eventName, "key_event_name_missing");
      const snapshotId = await this.persistSnapshot(
        db,
        GA_KEY_EVENT_ENTITY,
        gaScopedExternalId(propertyId, eventName),
        sanitized,
      );
      await db
        .insert(analyticsKeyEvents)
        .values({
          propertyExternalId: propertyId,
          eventName,
          resourceName: String(sanitized.name ?? eventName),
          countingMethod: optionalString(sanitized.countingMethod),
          custom:
            sanitized.custom === undefined ? null : String(sanitized.custom),
          providerCreateTime: optionalDate(sanitized.createTime),
          defaultCurrencyCode: defaultCurrency(sanitized),
          sourceSnapshotId: snapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsKeyEvents.propertyExternalId,
            analyticsKeyEvents.eventName,
          ],
          set: {
            resourceName: String(sanitized.name ?? eventName),
            countingMethod: optionalString(sanitized.countingMethod),
            custom:
              sanitized.custom === undefined ? null : String(sanitized.custom),
            providerCreateTime: optionalDate(sanitized.createTime),
            defaultCurrencyCode: defaultCurrency(sanitized),
            sourceSnapshotId: snapshotId,
            updatedAt: new Date(),
          },
        });
    }

    for (const dimension of listItems(
      await client.listCustomDimensions(),
      "customDimensions",
    )) {
      const sanitized = sanitizeCustomDimension(dimension);
      if (!sanitized) {
        continue;
      }
      assertNoSecrets(sanitized);
      await this.persistSnapshot(
        db,
        GA_CUSTOM_DIMENSION_ENTITY,
        gaScopedExternalId(propertyId, String(sanitized.parameterName ?? "unknown")),
        sanitized,
      );
    }
    for (const metric of listItems(
      await client.listCustomMetrics(),
      "customMetrics",
    )) {
      const sanitized = sanitizeCustomMetric(metric);
      assertNoSecrets(sanitized);
      await this.persistSnapshot(
        db,
        GA_CUSTOM_METRIC_ENTITY,
        gaScopedExternalId(propertyId, String(sanitized.parameterName ?? "unknown")),
        sanitized,
      );
    }

    return { propertyId, timezone, currency };
  }

  async importReports(options: {
    startDate: string;
    endDate: string;
    client?: GoogleAnalyticsClient;
    families?: readonly GaReportFamilyId[];
    dryRun?: boolean;
  }): Promise<GaImportWindowResult> {
    const families = options.families ?? GA_REPORT_DEFINITIONS.map((item) => item.id);
    if (options.dryRun) {
      return {
        propertyId: this.env.googleAnalytics?.propertyId ?? "dry-run",
        families: families.map((family) => {
          const definition = reportDefinition(family);
          return emptyFamily(definition.id, options.startDate, options.endDate);
        }),
        factsByFamily: {},
      };
    }
    const client = options.client ?? this.createClient();
    const propertyId = client.propertyId;
    const db = this.database.db;
    const results: GaFamilyReconcileTotals[] = [];
    const factsByFamily: Record<string, NormalizedFact[]> = {};
    const propertyRows = await db
      .select({ currencyCode: analyticsProperties.currencyCode })
      .from(analyticsProperties)
      .where(eq(analyticsProperties.propertyExternalId, propertyId))
      .limit(1);
    const currency = propertyRows[0]?.currencyCode ?? null;

    for (const family of families) {
      const definition = reportDefinition(family);
      const report = await client.runFamilyReport(
        definition,
        options.startDate,
        options.endDate,
      );
      const qualityError = qualityFailure(report.quality);
      if (qualityError) {
        throw new Error(qualityError);
      }
      const snapshot = sanitizeReportSnapshot(report);
      assertNoSecrets(snapshot);
      const snapshotId = await this.persistSnapshot(
        db,
        GA_REPORT_ENTITY,
        reportSnapshotExternalId(
          propertyId,
          definition.id,
          options.startDate,
          options.endDate,
        ),
        snapshot,
      );
      const facts = normalizeReportPayload(snapshot);
      factsByFamily[definition.id] = facts;

      if (isGaDailyComponentId(definition.id)) {
        await this.persistDailyComponent(
          db,
          propertyId,
          snapshotId,
          currency,
          definition.id,
          facts,
          options.startDate,
          options.endDate,
        );
      } else if (definition.canonicalFamily === "session_acquisition") {
        await this.persistSessionAcquisition(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "first_user_acquisition") {
        await this.persistFirstUser(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "landing_page") {
        await this.persistLanding(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "page_path") {
        await this.persistPagePath(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "event") {
        await this.persistEvents(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "country") {
        await this.persistCountry(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "device") {
        await this.persistDevice(db, propertyId, snapshotId, facts);
      } else if (definition.canonicalFamily === "ecommerce_item") {
        await this.persistItems(db, propertyId, snapshotId, facts);
      }

      results.push({
        family: definition.id,
        startDate: options.startDate,
        endDate: options.endDate,
        sourceRows: facts.length,
        providerRowCount: report.rowCount,
        canonicalRows: facts.length,
        unresolvedRows: 0,
        requestCount: report.requestCount,
        sampled: report.quality.sampled,
        dataLossFromOtherRow: report.quality.dataLossFromOtherRow,
        subjectToThresholding: report.quality.subjectToThresholding,
      });
    }

    return { propertyId, families: results, factsByFamily };
  }

  reconcileImportedWindow(imported: GaImportWindowResult) {
    const daily = imported.factsByFamily.daily_totals ?? [];
    return evaluateGaWindowReconciliation({
      rangeLabel: `${imported.families[0]?.startDate ?? ""}/${imported.families[0]?.endDate ?? ""}`,
      families: imported.families,
      dailySessions: sumMetric(daily, "sessions"),
      acquisitionSessions: sumMetric(
        imported.factsByFamily.session_acquisition ?? [],
        "sessions",
      ),
      eventCount: sumMetric(daily, "eventCount"),
      eventFamilyEventCount: sumMetric(
        imported.factsByFamily.event ?? [],
        "eventCount",
      ),
    });
  }

  private async persistSnapshot(
    db: GoogleAnalyticsImportDb,
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
          eq(sourceSnapshots.provider, GOOGLE_ANALYTICS_PROVIDER),
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
        provider: GOOGLE_ANALYTICS_PROVIDER,
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
    db: GoogleAnalyticsImportDb,
    entityType: string,
    externalId: string,
  ): Promise<void> {
    const existing = await db
      .select({ id: sourceIdentities.id })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, GOOGLE_ANALYTICS_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return;
    }
    await db.insert(sourceIdentities).values({
      provider: GOOGLE_ANALYTICS_PROVIDER,
      entityType,
      externalId,
    });
  }

  private async persistDailyComponent(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    snapshotId: string,
    currencyCode: string | null,
    component: GaDailyComponentId,
    facts: NormalizedFact[],
    startDate: string,
    endDate: string,
  ) {
    for (const fact of facts) {
      const owned = dailyOwnedValues(component, fact.metrics, snapshotId, currencyCode);
      await db
        .insert(analyticsDailyTotals)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          ...owned,
        })
        .onConflictDoUpdate({
          target: [
            analyticsDailyTotals.propertyExternalId,
            analyticsDailyTotals.farmDate,
          ],
          set: {
            ...owned,
            updatedAt: new Date(),
          },
        });
    }
    const snapshotField = DAILY_COMPONENT_SNAPSHOT_FIELD[component];
    const stamp =
      snapshotField === "siteTotalsSnapshotId"
        ? { siteTotalsSnapshotId: snapshotId, updatedAt: new Date() }
        : snapshotField === "engagementSnapshotId"
          ? { engagementSnapshotId: snapshotId, updatedAt: new Date() }
          : { ecommerceTotalsSnapshotId: snapshotId, updatedAt: new Date() };
    await db
      .update(analyticsDailyTotals)
      .set(stamp)
      .where(
        and(
          eq(analyticsDailyTotals.propertyExternalId, propertyId),
          gte(analyticsDailyTotals.farmDate, startDate),
          lte(analyticsDailyTotals.farmDate, endDate),
        ),
      );
  }

  private async persistSessionAcquisition(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsSessionAcquisition)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          sessionSource: fact.dimensions.sessionSource,
          sessionMedium: fact.dimensions.sessionMedium,
          sessionDefaultChannelGroup: fact.dimensions.sessionDefaultChannelGroup,
          sessions: fact.metrics.sessions ?? null,
          engagedSessions: fact.metrics.engagedSessions ?? null,
          keyEvents: fact.metrics.keyEvents ?? null,
          bounceRate: fact.metrics.bounceRate ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsSessionAcquisition.propertyExternalId,
            analyticsSessionAcquisition.farmDate,
            analyticsSessionAcquisition.sessionSource,
            analyticsSessionAcquisition.sessionMedium,
            analyticsSessionAcquisition.sessionDefaultChannelGroup,
          ],
          set: {
            sessions: fact.metrics.sessions ?? null,
            engagedSessions: fact.metrics.engagedSessions ?? null,
            keyEvents: fact.metrics.keyEvents ?? null,
            bounceRate: fact.metrics.bounceRate ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistFirstUser(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsFirstUserAcquisition)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          firstUserSource: fact.dimensions.firstUserSource,
          firstUserMedium: fact.dimensions.firstUserMedium,
          firstUserDefaultChannelGroup:
            fact.dimensions.firstUserDefaultChannelGroup,
          newUsers: fact.metrics.newUsers ?? null,
          activeUsers: fact.metrics.activeUsers ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsFirstUserAcquisition.propertyExternalId,
            analyticsFirstUserAcquisition.farmDate,
            analyticsFirstUserAcquisition.firstUserSource,
            analyticsFirstUserAcquisition.firstUserMedium,
            analyticsFirstUserAcquisition.firstUserDefaultChannelGroup,
          ],
          set: {
            newUsers: fact.metrics.newUsers ?? null,
            activeUsers: fact.metrics.activeUsers ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistLanding(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsLandingPages)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          landingPage: fact.dimensions.landingPage,
          sessions: fact.metrics.sessions ?? null,
          engagedSessions: fact.metrics.engagedSessions ?? null,
          keyEvents: fact.metrics.keyEvents ?? null,
          activeUsers: fact.metrics.activeUsers ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsLandingPages.propertyExternalId,
            analyticsLandingPages.farmDate,
            analyticsLandingPages.landingPage,
          ],
          set: {
            sessions: fact.metrics.sessions ?? null,
            engagedSessions: fact.metrics.engagedSessions ?? null,
            keyEvents: fact.metrics.keyEvents ?? null,
            activeUsers: fact.metrics.activeUsers ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistPagePath(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsPagePaths)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          pagePath: fact.dimensions.pagePath,
          screenPageViews: fact.metrics.screenPageViews ?? null,
          eventCount: fact.metrics.eventCount ?? null,
          activeUsers: fact.metrics.activeUsers ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsPagePaths.propertyExternalId,
            analyticsPagePaths.farmDate,
            analyticsPagePaths.pagePath,
          ],
          set: {
            screenPageViews: fact.metrics.screenPageViews ?? null,
            eventCount: fact.metrics.eventCount ?? null,
            activeUsers: fact.metrics.activeUsers ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistEvents(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsEvents)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          eventName: fact.dimensions.eventName,
          eventCount: fact.metrics.eventCount ?? null,
          activeUsers: fact.metrics.activeUsers ?? null,
          keyEvents: fact.metrics.keyEvents ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsEvents.propertyExternalId,
            analyticsEvents.farmDate,
            analyticsEvents.eventName,
          ],
          set: {
            eventCount: fact.metrics.eventCount ?? null,
            activeUsers: fact.metrics.activeUsers ?? null,
            keyEvents: fact.metrics.keyEvents ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistCountry(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsCountries)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          country: fact.dimensions.country,
          sessions: fact.metrics.sessions ?? null,
          activeUsers: fact.metrics.activeUsers ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsCountries.propertyExternalId,
            analyticsCountries.farmDate,
            analyticsCountries.country,
          ],
          set: {
            sessions: fact.metrics.sessions ?? null,
            activeUsers: fact.metrics.activeUsers ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistDevice(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsDevices)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          deviceCategory: fact.dimensions.deviceCategory,
          sessions: fact.metrics.sessions ?? null,
          engagedSessions: fact.metrics.engagedSessions ?? null,
          activeUsers: fact.metrics.activeUsers ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsDevices.propertyExternalId,
            analyticsDevices.farmDate,
            analyticsDevices.deviceCategory,
          ],
          set: {
            sessions: fact.metrics.sessions ?? null,
            engagedSessions: fact.metrics.engagedSessions ?? null,
            activeUsers: fact.metrics.activeUsers ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }

  private async persistItems(
    db: GoogleAnalyticsImportDb,
    propertyId: string,
    sourceSnapshotId: string,
    facts: NormalizedFact[],
  ) {
    for (const fact of facts) {
      await db
        .insert(analyticsEcommerceItems)
        .values({
          propertyExternalId: propertyId,
          farmDate: fact.farmDate,
          itemId: fact.dimensions.itemId,
          itemsViewed: fact.metrics.itemsViewed ?? null,
          itemsAddedToCart: fact.metrics.itemsAddedToCart ?? null,
          itemsPurchased: fact.metrics.itemsPurchased ?? null,
          itemRevenue: fact.metrics.itemRevenue ?? null,
          sourceSnapshotId,
        })
        .onConflictDoUpdate({
          target: [
            analyticsEcommerceItems.propertyExternalId,
            analyticsEcommerceItems.farmDate,
            analyticsEcommerceItems.itemId,
          ],
          set: {
            itemsViewed: fact.metrics.itemsViewed ?? null,
            itemsAddedToCart: fact.metrics.itemsAddedToCart ?? null,
            itemsPurchased: fact.metrics.itemsPurchased ?? null,
            itemRevenue: fact.metrics.itemRevenue ?? null,
            sourceSnapshotId,
            updatedAt: new Date(),
          },
        });
    }
  }
}

function emptyFamily(
  family: string,
  startDate: string,
  endDate: string,
): GaFamilyReconcileTotals {
  return {
    family,
    startDate,
    endDate,
    sourceRows: 0,
    providerRowCount: 0,
    canonicalRows: 0,
    unresolvedRows: 0,
    requestCount: 0,
    sampled: false,
    dataLossFromOtherRow: false,
    subjectToThresholding: false,
  };
}

function listItems(payload: GoogleAnalyticsJson, key: string): GoogleAnalyticsJson[] {
  const value = payload[key];
  return Array.isArray(value) ? (value as GoogleAnalyticsJson[]) : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function optionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("malformed_provider_time");
  }
  return date;
}

function dailyOwnedValues(
  component: GaDailyComponentId,
  metrics: Record<string, string>,
  snapshotId: string,
  currencyCode: string | null,
) {
  const currency = currencyCode ? { currencyCode } : {};
  if (component === "daily_engagement") {
    return {
      userEngagementDuration: metrics.userEngagementDuration ?? null,
      totalUsers: metrics.totalUsers ?? null,
      engagementSnapshotId: snapshotId,
      ...currency,
    };
  }
  if (component === "ecommerce_totals") {
    return {
      ecommercePurchases: metrics.ecommercePurchases ?? null,
      transactions: metrics.transactions ?? null,
      purchaseRevenue: metrics.purchaseRevenue ?? null,
      itemsPurchased: metrics.itemsPurchased ?? null,
      addToCarts: metrics.addToCarts ?? null,
      ecommerceTotalsSnapshotId: snapshotId,
      ...currency,
    };
  }
  return {
    sessions: metrics.sessions ?? null,
    activeUsers: metrics.activeUsers ?? null,
    newUsers: metrics.newUsers ?? null,
    engagedSessions: metrics.engagedSessions ?? null,
    engagementRate: metrics.engagementRate ?? null,
    bounceRate: metrics.bounceRate ?? null,
    averageSessionDuration: metrics.averageSessionDuration ?? null,
    eventCount: metrics.eventCount ?? null,
    screenPageViews: metrics.screenPageViews ?? null,
    keyEvents: metrics.keyEvents ?? null,
    siteTotalsSnapshotId: snapshotId,
    ...currency,
  };
}

function accountExternalId(property: Record<string, unknown>): string | null {
  const account = optionalString(property.account) ?? optionalString(property.parent);
  return account ? account.replace(/^accounts\//, "") : null;
}

function streamExternalId(stream: Record<string, unknown>): string {
  const name = optionalString(stream.name) ?? "unknown";
  const parts = name.split("/");
  return parts[parts.length - 1] ?? name;
}

function webMeasurement(
  stream: Record<string, unknown> | undefined,
  key: string,
): string | null {
  if (!stream) {
    return null;
  }
  const web =
    stream.webStreamData && typeof stream.webStreamData === "object"
      ? (stream.webStreamData as GoogleAnalyticsJson)
      : {};
  return optionalString(web[key]);
}

function defaultCurrency(event: Record<string, unknown>): string | null {
  const value =
    event.defaultValue && typeof event.defaultValue === "object"
      ? (event.defaultValue as GoogleAnalyticsJson)
      : {};
  return optionalString(value.currencyCode);
}
