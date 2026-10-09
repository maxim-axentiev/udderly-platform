export type MetaAdsJson = Record<string, unknown>;

export type MetaAdsClientConfig = {
  accessToken: string;
  accountId: string;
  timeoutMs?: number;
  pageLimit?: number;
  maxPages?: number;
  retryBackoffMs?: number;
  fetchImpl?: typeof fetch;
};

export type MetaAdsDateWindow = {
  from: string;
  to: string;
};

export type MetaAdsInsightLevel = "account" | "campaign" | "adset" | "ad";

export type MetaAdsPagedResult<T> = {
  items: T[];
  requestCount: number;
};

export type MetaAdsInsightRow = {
  dateStart: string;
  dateStop: string;
  objectId: string;
  campaignId?: string;
  adsetId?: string;
  adId?: string;
  spend: string;
  impressions: string;
  clicks: string;
  reach?: string;
  frequency?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
};

export type MetaAdsCompletedInsights = {
  level: MetaAdsInsightLevel;
  accountId: string;
  startDate: string;
  endDate: string;
  attributionWindow: string;
  rows: MetaAdsInsightRow[];
  rowCount: number;
  requestCount: number;
};
