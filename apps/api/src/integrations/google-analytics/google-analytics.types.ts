export type GoogleAnalyticsJson = Record<string, unknown>;

export type GoogleAnalyticsClientConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  propertyId: string;
  timeoutMs?: number;
  reportPageLimit?: number;
  maxPages?: number;
  retryBackoffMs?: number;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
};

export type GoogleAnalyticsConnectionStatus = {
  provider: "google_analytics";
  configured: boolean;
  connected: boolean;
};

export type GaDateWindow = {
  from: string;
  to: string;
};

export type GaReportRequest = {
  dimensions: string[];
  metrics: string[];
  startDate: string;
  endDate: string;
  limit?: number;
  offset?: number;
};

export type GaQuality = {
  subjectToThresholding: boolean;
  dataLossFromOtherRow: boolean;
  sampled: boolean;
};

export type GaReportPage = {
  rows: GoogleAnalyticsJson[];
  rowCount: number;
  dimensionHeaders: string[];
  metricHeaders: string[];
  quality: GaQuality;
  propertyQuota?: unknown;
};

export type GaCompletedReport = GaReportPage & {
  family: string;
  property?: string;
  startDate: string;
  endDate: string;
  requestCount: number;
};
