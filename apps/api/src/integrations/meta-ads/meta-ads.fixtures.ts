import { META_ADS_CANONICAL_ACCOUNT_ID } from "./meta-ads.constants";
import type { MetaAdsCompletedInsights, MetaAdsJson } from "./meta-ads.types";

export const MOCK_ACCESS_TOKEN = "EAAG-super-secret-token";

export const mockAccount: MetaAdsJson = {
  id: META_ADS_CANONICAL_ACCOUNT_ID,
  account_id: "1818645281666685",
  name: "Udderly Ridiculous Farm Life",
  currency: "CAD",
  timezone_name: "America/Toronto",
  account_status: "1",
  access_token: MOCK_ACCESS_TOKEN,
};

export const mockCampaign: MetaAdsJson = {
  id: "120210000000000001",
  name: "Farm awareness",
  status: "ACTIVE",
  effective_status: "ACTIVE",
  objective: "OUTCOME_TRAFFIC",
  daily_budget: "2500",
};

export function insightRow(overrides: Record<string, string> = {}): MetaAdsJson {
  return {
    date_start: "2026-09-30",
    date_stop: "2026-09-30",
    account_id: "1818645281666685",
    campaign_id: "120210000000000001",
    spend: "12.34",
    impressions: "100",
    clicks: "4",
    reach: "80",
    frequency: "1.25",
    cpc: "3.085",
    cpm: "123.40",
    ctr: "4.0",
    ...overrides,
  };
}

export function completedInsights(
  extras: Partial<MetaAdsCompletedInsights> = {},
): MetaAdsCompletedInsights {
  return {
    level: "account",
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    startDate: "2026-09-30",
    endDate: "2026-09-30",
    attributionWindow: "7d_click,1d_view",
    rows: [
      {
        dateStart: "2026-09-30",
        dateStop: "2026-09-30",
        objectId: "1818645281666685",
        spend: "12.34",
        impressions: "100",
        clicks: "4",
      },
    ],
    rowCount: 1,
    requestCount: 1,
    ...extras,
  };
}
