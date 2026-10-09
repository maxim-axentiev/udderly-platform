import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../database/database.service";
import { DatabaseService } from "../../database/database.service";
import { EnvService } from "../../config/env.service";
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
import { MailchimpClient } from "./mailchimp.client";
import {
  MAILCHIMP_ACCOUNT_ENTITY,
  MAILCHIMP_AUDIENCE_ENTITY,
  MAILCHIMP_CAMPAIGN_ENTITY,
  MAILCHIMP_CAMPAIGN_REPORT_ENTITY,
  MAILCHIMP_CLICK_REPORT_ENTITY,
  MAILCHIMP_GROWTH_HISTORY_ENTITY,
  MAILCHIMP_LIST_ACTIVITY_ENTITY,
  MAILCHIMP_PROVIDER,
  MAILCHIMP_REPORTING_TIME_ZONE,
} from "./mailchimp.constants";
import {
  classifyMailchimpActivityCoverage,
  daysForDates,
} from "./mailchimp.coverage";
import { hashCanonicalJson } from "./mailchimp.hash";
import {
  mailchimpAccountExternalId,
  mailchimpActivityExternalId,
  mailchimpAudienceExternalId,
  mailchimpCampaignExternalId,
  mailchimpClickExternalId,
  mailchimpGrowthExternalId,
  mailchimpReportExternalId,
} from "./mailchimp.identity";
import {
  normalizeActivityDay,
  normalizeClickDetail,
  normalizeGrowthMonth,
} from "./mailchimp.normalize";
import { assertMailchimpQuality } from "./mailchimp.quality";
import { evaluateMailchimpWindowReconciliation } from "./mailchimp.reconcile";
import {
  planMailchimpActivityReplacement,
  planMailchimpLinkReplacement,
  planMailchimpReportReplacement,
} from "./mailchimp.replace";
import {
  civilDateInTimeZone,
  mailchimpDatesInclusive,
  monthsOverlappingRange,
} from "./mailchimp.range";
import {
  assertNoPii,
  assertNoSecrets,
  sanitizeAccount,
  sanitizeActivityDay,
  sanitizeAudience,
  sanitizeCampaign,
  sanitizeCampaignReport,
  sanitizeClickDetail,
  sanitizeGrowthMonth,
} from "./mailchimp.sanitize";
import type { MailchimpActivityDay } from "./mailchimp.types";

export type MailchimpImportDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute" | "transaction"
>;

export type MailchimpImportWindowResult = {
  accountId: string;
  audienceCount: number;
  activityRows: number;
  providerActivityCount: number;
  campaignCount: number;
  reportCount: number;
  missingReportIds: string[];
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  replacedDates: string[];
  replacedCampaignIds: string[];
  skippedIncompleteLinkIds: string[];
};

@Injectable()
export class MailchimpImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EnvService) private readonly env: EnvService,
  ) {}

  createClient(): MailchimpClient {
    const config = this.env.mailchimp;
    if (!config) {
      throw new Error("mailchimp_not_configured");
    }
    return new MailchimpClient({ apiKey: config.apiKey });
  }

  async importAccount(client?: MailchimpClient): Promise<{
    accountId: string;
    name: string | undefined;
  }> {
    const resolved = client ?? this.createClient();
    const db = this.database.db;
    const account = sanitizeAccount(await resolved.getAccount());
    assertNoSecrets(account);
    assertNoPii(account);
    const accountId = requiredString(account.account_id, "mailchimp_account_id_missing");
    const timezone = requiredString(account.timezone, "mailchimp_timezone_missing");
    assertMailchimpQuality({ timezone });
    const name = optionalString(account.account_name);
    const snapshotId = await this.persistSnapshot(
      db,
      MAILCHIMP_ACCOUNT_ENTITY,
      mailchimpAccountExternalId(accountId),
      account,
    );
    await this.upsertAccount(db, { accountId, name, timezone, snapshotId });
    return { accountId, name };
  }

  async importWindow(options: {
    startDate: string;
    endDate: string;
    client?: MailchimpClient;
    importActivity?: boolean;
    importCampaigns?: boolean;
    replaceActivityDates?: readonly string[];
  }): Promise<MailchimpImportWindowResult> {
    const importActivity = options.importActivity !== false;
    const importCampaigns = options.importCampaigns !== false;
    const client = options.client ?? this.createClient();
    const db = this.database.db;
    const account = await this.importAccount(client);
    const audiencesPage = await client.listAudiences();
    const audiences = audiencesPage.items.map((item) => {
      const sanitized = sanitizeAudience(item);
      assertNoSecrets(sanitized);
      assertNoPii(sanitized);
      return sanitized;
    });

    const activityCandidates = new Set(
      options.replaceActivityDates
        ? options.replaceActivityDates.filter(
            (date) => date >= options.startDate && date <= options.endDate,
          )
        : mailchimpDatesInclusive(options.startDate, options.endDate),
    );
    const candidateFrom = [...activityCandidates].sort()[0] ?? options.startDate;
    const candidateTo =
      [...activityCandidates].sort().at(-1) ?? options.endDate;

    const activityByList = new Map<string, MailchimpActivityDay[]>();
    const growthByList = new Map<string, ReturnType<typeof normalizeGrowthMonth>[]>();
    let providerActivityCount = 0;

    if (importActivity) {
      for (const audience of audiences) {
        const listId = requiredString(audience.id, "mailchimp_list_id_missing");
        const growthPage = await client.listGrowthHistory(listId);
        const allowedMonths = new Set(
          monthsOverlappingRange(options.startDate, options.endDate),
        );
        growthByList.set(
          listId,
          growthPage.items
            .map((item) => normalizeGrowthMonth(listId, sanitizeGrowthMonth(item)))
            .filter((row) => allowedMonths.has(row.month)),
        );
        const activityPage = await client.listActivity(listId);
        const days = activityPage.items.map((item) => {
          const sanitized = sanitizeActivityDay(item);
          assertNoSecrets(sanitized);
          assertNoPii(sanitized);
          return normalizeActivityDay(listId, sanitized);
        });
        providerActivityCount += days.filter((row) =>
          activityCandidates.has(row.day),
        ).length;
        activityByList.set(listId, days);
      }
    }

    const campaigns = importCampaigns
      ? (await client.listSentCampaigns()).items
          .map((item) => {
            const sanitized = sanitizeCampaign(item);
            assertNoSecrets(sanitized);
            assertNoPii(sanitized);
            return sanitized;
          })
          .filter((campaign) => {
            const sendTime = optionalString(campaign.send_time);
            if (!sendTime) {
              return false;
            }
            const sendDate = civilDateInTimeZone(
              sendTime,
              MAILCHIMP_REPORTING_TIME_ZONE,
            );
            return sendDate >= options.startDate && sendDate <= options.endDate;
          })
      : [];

    const reports = importCampaigns
      ? (await client.listReports()).items.map((item) => {
          const sanitized = sanitizeCampaignReport(item);
          assertNoSecrets(sanitized);
          assertNoPii(sanitized);
          return sanitized;
        })
      : [];
    const reportsById = new Map(
      reports.map((report) => [
        requiredString(report.id, "mailchimp_campaign_id_missing"),
        report,
      ]),
    );

    const sentIds = campaigns.map((campaign) =>
      requiredString(campaign.id, "mailchimp_campaign_id_missing"),
    );
    const reportPlan = planMailchimpReportReplacement({
      sentCampaignIds: sentIds,
      reportedCampaignIds: [...reportsById.keys()],
    });

    const clicksByCampaign = new Map<
      string,
      ReturnType<typeof normalizeClickDetail>[]
    >();
    const skippedIncompleteLinkIds: string[] = [];
    if (importCampaigns) {
      for (const campaignId of reportPlan.replaceCampaignIds) {
        const clickPage = await client.listClickDetails(campaignId);
        const links = clickPage.items.map((item) => {
          const sanitized = sanitizeClickDetail(item);
          assertNoSecrets(sanitized);
          assertNoPii(sanitized);
          return normalizeClickDetail(campaignId, sanitized);
        });
        const report = reportsById.get(campaignId);
        const clicks =
          report?.clicks && typeof report.clicks === "object"
            ? (report.clicks as Record<string, unknown>)
            : {};
        const uniqueClicks =
          typeof clicks.unique_clicks === "number" ? clicks.unique_clicks : undefined;
        const linkPlan = planMailchimpLinkReplacement({
          campaignId,
          uniqueClicks,
          detailCount: links.length,
        });
        if (!linkPlan.replace) {
          skippedIncompleteLinkIds.push(campaignId);
          continue;
        }
        clicksByCampaign.set(campaignId, links);
      }
    }

    const allActivityDays = [...activityByList.values()]
      .flat()
      .map((row) => row.day)
      .filter((day) => activityCandidates.has(day));
    const coverage = importActivity
      ? classifyMailchimpActivityCoverage({
          from: candidateFrom,
          to: candidateTo,
          activityDays: allActivityDays,
        })
      : { publishedDates: [], possiblyUnpublishedDates: [] };

    const replacedDates = new Set<string>();

    await db.transaction(async (tx) => {
      for (const audience of audiences) {
        const listId = requiredString(audience.id, "mailchimp_list_id_missing");
        const snapshotId = await this.persistSnapshot(
          tx,
          MAILCHIMP_AUDIENCE_ENTITY,
          mailchimpAudienceExternalId(listId),
          audience,
        );
        await this.upsertAudience(tx, audience, snapshotId);
        if (!importActivity) {
          continue;
        }
        const listDays = (activityByList.get(listId) ?? []).filter((row) =>
          activityCandidates.has(row.day),
        );
        const listCoverage = classifyMailchimpActivityCoverage({
          from: candidateFrom,
          to: candidateTo,
          activityDays: listDays.map((row) => row.day),
        });
        const plan = planMailchimpActivityReplacement({
          listId,
          publishedDates: listCoverage.publishedDates,
          possiblyUnpublishedDates: listCoverage.possiblyUnpublishedDates,
        });
        for (const date of plan.replaceDates) {
          replacedDates.add(date);
        }
        await this.replaceActivity(
          tx,
          listId,
          daysForDates(
            listDays.map((row) => row.day),
            plan.replaceDates,
          ).map((day) => listDays.find((row) => row.day === day)!),
          plan.replaceDates,
        );
        for (const day of listDays.filter((row) => plan.replaceDates.includes(row.day))) {
          await this.persistSnapshot(
            tx,
            MAILCHIMP_LIST_ACTIVITY_ENTITY,
            mailchimpActivityExternalId(listId, day.day),
            { ...day },
          );
        }
        for (const month of growthByList.get(listId) ?? []) {
          const monthSnapshot = await this.persistSnapshot(
            tx,
            MAILCHIMP_GROWTH_HISTORY_ENTITY,
            mailchimpGrowthExternalId(listId, month.month),
            month as unknown as Record<string, unknown>,
          );
          await this.upsertMonthly(tx, month, monthSnapshot);
        }
      }

      for (const campaign of campaigns) {
        const campaignId = requiredString(campaign.id, "mailchimp_campaign_id_missing");
        const snapshotId = await this.persistSnapshot(
          tx,
          MAILCHIMP_CAMPAIGN_ENTITY,
          mailchimpCampaignExternalId(campaignId),
          campaign,
        );
        await this.upsertCampaign(tx, campaign, snapshotId);
      }

      for (const campaignId of reportPlan.replaceCampaignIds) {
        const report = reportsById.get(campaignId);
        if (!report) {
          continue;
        }
        const snapshotId = await this.persistSnapshot(
          tx,
          MAILCHIMP_CAMPAIGN_REPORT_ENTITY,
          mailchimpReportExternalId(campaignId),
          report,
        );
        await this.replaceReport(tx, report, snapshotId);
        const links = clicksByCampaign.get(campaignId);
        if (links) {
          await this.replaceLinks(tx, campaignId, links, snapshotId);
          for (const link of links) {
            await this.persistSnapshot(
              tx,
              MAILCHIMP_CLICK_REPORT_ENTITY,
              mailchimpClickExternalId(campaignId, link.linkId),
              link as unknown as Record<string, unknown>,
            );
          }
        }
      }
    });

    const activityRows = [...activityByList.values()]
      .flat()
      .filter((row) => activityCandidates.has(row.day)).length;

    return {
      accountId: account.accountId,
      audienceCount: audiences.length,
      activityRows,
      providerActivityCount,
      campaignCount: campaigns.length,
      reportCount: reportPlan.replaceCampaignIds.length,
      missingReportIds: reportPlan.skippedMissingReportIds,
      publishedDates: coverage.publishedDates,
      possiblyUnpublishedDates: importActivity
        ? mailchimpDatesInclusive(options.startDate, options.endDate).filter(
            (date) =>
              activityCandidates.has(date) && !coverage.publishedDates.includes(date),
          )
        : [],
      replacedDates: [...replacedDates].sort(),
      replacedCampaignIds: reportPlan.replaceCampaignIds,
      skippedIncompleteLinkIds,
    };
  }

  reconcileImportedWindow(imported: MailchimpImportWindowResult) {
    return evaluateMailchimpWindowReconciliation({
      rangeLabel: `${imported.publishedDates[0] ?? ""}/${imported.publishedDates.at(-1) ?? ""}`,
      audienceCount: imported.audienceCount,
      activityRows: imported.activityRows,
      providerActivityCount: imported.providerActivityCount,
      campaignCount: imported.campaignCount,
      reportCount: imported.reportCount,
      missingReportCount: imported.missingReportIds.length,
      publishedDates: imported.publishedDates,
      possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
      skippedIncompleteLinkCount: imported.skippedIncompleteLinkIds.length,
    });
  }

  private async persistSnapshot(
    db: MailchimpImportDb,
    entityType: string,
    externalId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    assertNoSecrets(payload);
    assertNoPii(payload);
    const payloadHash = hashCanonicalJson(payload);
    const existing = await db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, MAILCHIMP_PROVIDER),
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
        provider: MAILCHIMP_PROVIDER,
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
    db: MailchimpImportDb,
    entityType: string,
    externalId: string,
  ): Promise<void> {
    const existing = await db
      .select({ id: sourceIdentities.id })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, MAILCHIMP_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return;
    }
    await db.insert(sourceIdentities).values({
      provider: MAILCHIMP_PROVIDER,
      entityType,
      externalId,
    });
  }

  private async upsertAccount(
    db: MailchimpImportDb,
    input: {
      accountId: string;
      name?: string;
      timezone: string;
      snapshotId: string;
    },
  ): Promise<void> {
    const existing = await db
      .select({ id: mailchimpAccounts.id })
      .from(mailchimpAccounts)
      .where(eq(mailchimpAccounts.accountExternalId, input.accountId))
      .limit(1);
    const values = {
      name: input.name ?? null,
      timezoneName: input.timezone,
      sourceSnapshotId: input.snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(mailchimpAccounts)
        .set(values)
        .where(eq(mailchimpAccounts.id, existing[0].id));
      return;
    }
    await db.insert(mailchimpAccounts).values({
      accountExternalId: input.accountId,
      ...values,
    });
  }

  private async upsertAudience(
    db: MailchimpImportDb,
    audience: Record<string, unknown>,
    snapshotId: string,
  ): Promise<void> {
    const listId = requiredString(audience.id, "mailchimp_list_id_missing");
    const stats =
      audience.stats && typeof audience.stats === "object"
        ? (audience.stats as Record<string, unknown>)
        : {};
    const existing = await db
      .select({ id: mailchimpAudiences.id })
      .from(mailchimpAudiences)
      .where(eq(mailchimpAudiences.listExternalId, listId))
      .limit(1);
    const values = {
      name: optionalString(audience.name) ?? null,
      memberCount: optionalInt(stats.member_count) ?? null,
      unsubscribeCount: optionalInt(stats.unsubscribe_count) ?? null,
      cleanedCount: optionalInt(stats.cleaned_count) ?? null,
      sourceSnapshotId: snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(mailchimpAudiences)
        .set(values)
        .where(eq(mailchimpAudiences.id, existing[0].id));
      return;
    }
    await db.insert(mailchimpAudiences).values({
      listExternalId: listId,
      ...values,
    });
  }

  private async upsertMonthly(
    db: MailchimpImportDb,
    month: ReturnType<typeof normalizeGrowthMonth>,
    snapshotId: string,
  ): Promise<void> {
    const existing = await db
      .select({ id: mailchimpAudienceMonthly.id })
      .from(mailchimpAudienceMonthly)
      .where(
        and(
          eq(mailchimpAudienceMonthly.listExternalId, month.listId),
          eq(mailchimpAudienceMonthly.yearMonth, month.month),
        ),
      )
      .limit(1);
    const values = {
      subscribed: month.subscribed ?? null,
      unsubscribed: month.unsubscribed ?? null,
      cleaned: month.cleaned ?? null,
      deleted: month.deleted ?? null,
      pending: month.pending ?? null,
      reconfirm: month.reconfirm ?? null,
      sourceSnapshotId: snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(mailchimpAudienceMonthly)
        .set(values)
        .where(eq(mailchimpAudienceMonthly.id, existing[0].id));
      return;
    }
    await db.insert(mailchimpAudienceMonthly).values({
      listExternalId: month.listId,
      yearMonth: month.month,
      ...values,
    });
  }

  private async replaceActivity(
    db: Pick<AppDatabase, "insert" | "delete">,
    listId: string,
    days: MailchimpActivityDay[],
    replaceDates: readonly string[],
  ): Promise<void> {
    if (replaceDates.length === 0) {
      return;
    }
    await db
      .delete(mailchimpAudienceDaily)
      .where(
        and(
          eq(mailchimpAudienceDaily.listExternalId, listId),
          inArray(mailchimpAudienceDaily.metricDate, [...replaceDates]),
        ),
      );
    for (const day of days) {
      await db.insert(mailchimpAudienceDaily).values({
        listExternalId: listId,
        metricDate: day.day,
        emailsSent: day.emailsSent ?? null,
        uniqueOpens: day.uniqueOpens ?? null,
        recipientClicks: day.recipientClicks ?? null,
        hardBounce: day.hardBounce ?? null,
        softBounce: day.softBounce ?? null,
        subs: day.subs ?? null,
        unsubs: day.unsubs ?? null,
        otherAdds: day.otherAdds ?? null,
        otherRemoves: day.otherRemoves ?? null,
      });
    }
  }

  private async upsertCampaign(
    db: MailchimpImportDb,
    campaign: Record<string, unknown>,
    snapshotId: string,
  ): Promise<void> {
    const campaignId = requiredString(campaign.id, "mailchimp_campaign_id_missing");
    const settings =
      campaign.settings && typeof campaign.settings === "object"
        ? (campaign.settings as Record<string, unknown>)
        : {};
    const recipients =
      campaign.recipients && typeof campaign.recipients === "object"
        ? (campaign.recipients as Record<string, unknown>)
        : {};
    const tracking =
      campaign.tracking && typeof campaign.tracking === "object"
        ? (campaign.tracking as Record<string, unknown>)
        : {};
    const existing = await db
      .select({ id: mailchimpCampaigns.id })
      .from(mailchimpCampaigns)
      .where(eq(mailchimpCampaigns.campaignExternalId, campaignId))
      .limit(1);
    const values = {
      listExternalId: optionalString(recipients.list_id) ?? null,
      type: optionalString(campaign.type) ?? null,
      status: optionalString(campaign.status) ?? null,
      title: optionalString(settings.title) ?? null,
      subjectLine: optionalString(settings.subject_line) ?? null,
      sendTime: optionalString(campaign.send_time) ?? null,
      gaCampaignName: optionalString(tracking.google_analytics) ?? null,
      sourceSnapshotId: snapshotId,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db
        .update(mailchimpCampaigns)
        .set(values)
        .where(eq(mailchimpCampaigns.id, existing[0].id));
      return;
    }
    await db.insert(mailchimpCampaigns).values({
      campaignExternalId: campaignId,
      ...values,
    });
  }

  private async replaceReport(
    db: MailchimpImportDb,
    report: Record<string, unknown>,
    snapshotId: string,
  ): Promise<void> {
    const campaignId = requiredString(report.id, "mailchimp_campaign_id_missing");
    const opens =
      report.opens && typeof report.opens === "object"
        ? (report.opens as Record<string, unknown>)
        : {};
    const clicks =
      report.clicks && typeof report.clicks === "object"
        ? (report.clicks as Record<string, unknown>)
        : {};
    const bounces =
      report.bounces && typeof report.bounces === "object"
        ? (report.bounces as Record<string, unknown>)
        : {};
    await db
      .delete(mailchimpCampaignReports)
      .where(eq(mailchimpCampaignReports.campaignExternalId, campaignId));
    await db.insert(mailchimpCampaignReports).values({
      campaignExternalId: campaignId,
      listExternalId: optionalString(report.list_id) ?? null,
      emailsSent: optionalInt(report.emails_sent) ?? null,
      abuseReports: optionalInt(report.abuse_reports) ?? null,
      unsubscribed: optionalInt(report.unsubscribed) ?? null,
      hardBounces: optionalInt(bounces.hard_bounces) ?? null,
      softBounces: optionalInt(bounces.soft_bounces) ?? null,
      opensTotal: optionalInt(opens.opens_total) ?? null,
      uniqueOpens: optionalInt(opens.unique_opens) ?? null,
      proxyExcludedUniqueOpens: optionalInt(opens.proxy_excluded_unique_opens) ?? null,
      openRate:
        typeof opens.open_rate === "number" ? String(opens.open_rate) : null,
      clicksTotal: optionalInt(clicks.clicks_total) ?? null,
      uniqueClicks: optionalInt(clicks.unique_clicks) ?? null,
      uniqueSubscriberClicks: optionalInt(clicks.unique_subscriber_clicks) ?? null,
      clickRate:
        typeof clicks.click_rate === "number" ? String(clicks.click_rate) : null,
      sendTime: optionalString(report.send_time) ?? null,
      sourceSnapshotId: snapshotId,
    });
  }

  private async replaceLinks(
    db: Pick<AppDatabase, "insert" | "delete">,
    campaignId: string,
    links: ReturnType<typeof normalizeClickDetail>[],
    snapshotId: string,
  ): Promise<void> {
    await db
      .delete(mailchimpCampaignLinks)
      .where(eq(mailchimpCampaignLinks.campaignExternalId, campaignId));
    for (const link of links) {
      await db.insert(mailchimpCampaignLinks).values({
        campaignExternalId: campaignId,
        linkExternalId: link.linkId,
        url: link.url ?? null,
        totalClicks: link.totalClicks ?? null,
        uniqueClicks: link.uniqueClicks ?? null,
        sourceSnapshotId: snapshotId,
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return undefined;
}
