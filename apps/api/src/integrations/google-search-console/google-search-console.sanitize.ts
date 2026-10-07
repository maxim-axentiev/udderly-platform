import { gscReportExternalId } from "./google-search-console.identity";
import type {
  GscCompletedReport,
  GoogleSearchConsoleJson,
} from "./google-search-console.types";

const SITE_KEYS = ["siteUrl", "permissionLevel"] as const;
const ROW_KEYS = ["keys", "clicks", "impressions", "ctr", "position", "gscDate"] as const;

export function sanitizeSite(payload: GoogleSearchConsoleJson): Record<string, unknown> {
  return pick(payload, [...SITE_KEYS]);
}

export function sanitizeReportSnapshot(
  report: GscCompletedReport,
): Record<string, unknown> {
  return {
    family: report.family,
    siteUrl: report.siteUrl,
    startDate: report.startDate,
    endDate: report.endDate,
    dataState: report.dataState,
    searchType: report.searchType,
    dimensions: report.dimensions,
    rowCount: report.rowCount,
    requestCount: report.requestCount,
    responseAggregationType: report.responseAggregationType,
    rows: report.rows.map(sanitizeReportRow),
  };
}

export function reportSnapshotExternalId(
  siteUrl: string,
  family: string,
  startDate: string,
  endDate: string,
): string {
  return gscReportExternalId(siteUrl, family, startDate, endDate);
}

export function assertNoSecrets(payload: unknown): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const banned of [
    "refresh_token",
    "client_secret",
    "access_token",
    "api_secret",
    "apisecret",
  ]) {
    if (serialized.includes(banned.toLowerCase())) {
      throw new Error("snapshot_contains_secret");
    }
  }
}

function sanitizeReportRow(row: GscCompletedReport["rows"][number]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ROW_KEYS) {
    if (row[key] !== undefined) {
      out[key] = row[key];
    }
  }
  return out;
}

function pick(
  payload: GoogleSearchConsoleJson,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) {
      out[key] = payload[key];
    }
  }
  return out;
}
