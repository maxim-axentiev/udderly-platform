export type GoogleSearchConsoleJson = Record<string, unknown>;

export type GoogleSearchConsoleClientConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  siteUrl: string;
  timeoutMs?: number;
  reportRowLimit?: number;
  maxPages?: number;
  retryBackoffMs?: number;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
};

export type GscDateWindow = {
  from: string;
  to: string;
};

export type GscQuality = {
  dataState: "final";
  searchType: "web";
};

export type GscReportRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** Set when the API cannot return a date dimension (search appearance). */
  gscDate?: string;
};

export type GscCompletedReport = {
  family: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  dataState: "final";
  searchType: "web";
  dimensions: string[];
  rows: GscReportRow[];
  rowCount: number;
  requestCount: number;
  responseAggregationType?: string;
};
