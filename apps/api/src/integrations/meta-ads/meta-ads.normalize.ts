import {
  META_ADS_ATTRIBUTION_WINDOW_ID,
  META_ADS_CANONICAL_CURRENCY,
} from "./meta-ads.constants";
import { parseMajorCurrencyToMinorUnits } from "./meta-ads.money";
import { qualityFailure } from "./meta-ads.quality";
import { assertMetaAdsDate } from "./meta-ads.range";
import { insightLevel } from "./meta-ads.reports";
import type { MetaAdsInsightLevel } from "./meta-ads.types";

export type NormalizedMetaAdsFact = {
  level: MetaAdsInsightLevel;
  metricDate: string;
  objectId: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  attributionWindow: string;
  spendAmount: number;
  currency: string;
  impressions: string;
  clicks: string;
  reach?: string;
  frequency?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
};

export function normalizeInsightPayload(
  payload: Record<string, unknown>,
): NormalizedMetaAdsFact[] {
  const level = insightLevel(String(payload.level ?? ""));
  const qualityError = qualityFailure({
    attributionWindow:
      typeof payload.attributionWindow === "string"
        ? payload.attributionWindow
        : undefined,
  });
  if (qualityError) {
    throw new Error(qualityError);
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const facts: NormalizedMetaAdsFact[] = [];
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("malformed_row");
    }
    const fact = normalizeRow(level, row as Record<string, unknown>);
    const key = `${fact.metricDate}|${fact.objectId}|${fact.attributionWindow}`;
    if (keys.has(key)) {
      throw new Error("duplicate_dimension_key");
    }
    keys.add(key);
    facts.push(fact);
  }
  return facts;
}

function normalizeRow(
  level: MetaAdsInsightLevel,
  row: Record<string, unknown>,
): NormalizedMetaAdsFact {
  const dateStart = requiredString(row.dateStart, "malformed_row");
  const dateStop = requiredString(row.dateStop, "malformed_row");
  assertMetaAdsDate(dateStart);
  assertMetaAdsDate(dateStop);
  if (dateStart !== dateStop) {
    throw new Error("meta_ads_insight_not_daily");
  }
  const objectId = requiredString(row.objectId, "malformed_row");
  const spend = requiredString(row.spend, "malformed_row");
  return {
    level,
    metricDate: dateStart,
    objectId,
    campaignId: optionalString(row.campaignId),
    adsetId: optionalString(row.adsetId),
    adId: optionalString(row.adId),
    attributionWindow: META_ADS_ATTRIBUTION_WINDOW_ID,
    spendAmount: parseMajorCurrencyToMinorUnits(spend, META_ADS_CANONICAL_CURRENCY),
    currency: META_ADS_CANONICAL_CURRENCY,
    impressions: requiredString(row.impressions, "malformed_row"),
    clicks: requiredString(row.clicks, "malformed_row"),
    reach: optionalString(row.reach),
    frequency: optionalString(row.frequency),
    cpc: optionalString(row.cpc),
    cpm: optionalString(row.cpm),
    ctr: optionalString(row.ctr),
  };
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
