import { META_ADS_ATTRIBUTION_WINDOW_ID } from "./meta-ads.constants";
import { metaAdsInsightExternalId } from "./meta-ads.identity";
import type {
  MetaAdsCompletedInsights,
  MetaAdsInsightRow,
  MetaAdsJson,
} from "./meta-ads.types";

const ACCOUNT_KEYS = [
  "id",
  "account_id",
  "name",
  "currency",
  "timezone_name",
  "account_status",
] as const;

const CAMPAIGN_KEYS = [
  "id",
  "name",
  "status",
  "effective_status",
  "objective",
  "daily_budget",
  "lifetime_budget",
] as const;

const AD_SET_KEYS = [
  "id",
  "campaign_id",
  "name",
  "status",
  "effective_status",
  "daily_budget",
  "lifetime_budget",
] as const;

const AD_KEYS = [
  "id",
  "adset_id",
  "campaign_id",
  "name",
  "status",
  "effective_status",
] as const;

export function sanitizeAccount(payload: MetaAdsJson): Record<string, unknown> {
  return pick(payload, [...ACCOUNT_KEYS]);
}

export function sanitizeCampaign(payload: MetaAdsJson): Record<string, unknown> {
  return pick(payload, [...CAMPAIGN_KEYS]);
}

export function sanitizeAdSet(payload: MetaAdsJson): Record<string, unknown> {
  return pick(payload, [...AD_SET_KEYS]);
}

export function sanitizeAd(payload: MetaAdsJson): Record<string, unknown> {
  return pick(payload, [...AD_KEYS]);
}

export function sanitizeInsightSnapshot(
  report: MetaAdsCompletedInsights,
): Record<string, unknown> {
  return {
    level: report.level,
    accountId: report.accountId,
    startDate: report.startDate,
    endDate: report.endDate,
    attributionWindow: report.attributionWindow,
    rowCount: report.rowCount,
    requestCount: report.requestCount,
    rows: report.rows.map(sanitizeInsightRow),
  };
}

export function insightSnapshotExternalId(
  accountId: string,
  level: MetaAdsCompletedInsights["level"],
  startDate: string,
  endDate: string,
): string {
  return metaAdsInsightExternalId(accountId, level, startDate, endDate);
}

export function assertNoSecrets(payload: unknown): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const banned of [
    "access_token",
    "app_secret",
    "client_secret",
    "refresh_token",
    "api_secret",
  ]) {
    if (serialized.includes(banned)) {
      throw new Error("snapshot_contains_secret");
    }
  }
}

export function assertPinnedAttribution(window: string): void {
  if (window !== META_ADS_ATTRIBUTION_WINDOW_ID) {
    throw new Error("meta_ads_attribution_window_mismatch");
  }
}

function sanitizeInsightRow(row: MetaAdsInsightRow): Record<string, unknown> {
  return {
    dateStart: row.dateStart,
    dateStop: row.dateStop,
    objectId: row.objectId,
    campaignId: row.campaignId,
    adsetId: row.adsetId,
    adId: row.adId,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    reach: row.reach,
    frequency: row.frequency,
    cpc: row.cpc,
    cpm: row.cpm,
    ctr: row.ctr,
  };
}

function pick(payload: MetaAdsJson, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  return out;
}
