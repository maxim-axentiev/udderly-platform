import {
  FORBIDDEN_CUSTOM_DIMENSION_NAMES,
} from "./google-analytics.constants";
import { isForbiddenDimension } from "./google-analytics.reports";
import type { GaCompletedReport, GoogleAnalyticsJson } from "./google-analytics.types";

const REPORT_ROW_KEYS = new Set(["dimensionValues", "metricValues"]);

import { gaReportExternalId } from "./google-analytics.identity";

export function sanitizeReportSnapshot(
  report: GaCompletedReport,
): Record<string, unknown> {
  return {
    family: report.family,
    property: report.property,
    startDate: report.startDate,
    endDate: report.endDate,
    dimensionHeaders: report.dimensionHeaders,
    metricHeaders: report.metricHeaders,
    rowCount: report.rowCount,
    requestCount: report.requestCount,
    quality: report.quality,
    quota: sanitizeQuota(report.propertyQuota),
    rows: report.rows.map(sanitizeReportRow),
  };
}

export function reportSnapshotExternalId(
  propertyId: string,
  family: string,
  startDate: string,
  endDate: string,
): string {
  return gaReportExternalId(propertyId, family, startDate, endDate);
}

export function sanitizeProperty(payload: GoogleAnalyticsJson): Record<string, unknown> {
  return pick(payload, [
    "name",
    "displayName",
    "createTime",
    "updateTime",
    "timeZone",
    "currencyCode",
    "industryCategory",
    "serviceLevel",
    "propertyType",
    "parent",
    "account",
  ]);
}

export function sanitizeRetention(payload: GoogleAnalyticsJson): Record<string, unknown> {
  return pick(payload, [
    "name",
    "eventDataRetention",
    "userDataRetention",
    "resetUserDataOnNewActivity",
  ]);
}

export function sanitizeStream(payload: GoogleAnalyticsJson): Record<string, unknown> {
  const web =
    payload.webStreamData && typeof payload.webStreamData === "object"
      ? (payload.webStreamData as GoogleAnalyticsJson)
      : {};
  return {
    name: payload.name,
    displayName: payload.displayName,
    type: payload.type,
    createTime: payload.createTime,
    updateTime: payload.updateTime,
    webStreamData: {
      measurementId: web.measurementId,
      defaultUri: web.defaultUri,
    },
  };
}

export function sanitizeKeyEvent(payload: GoogleAnalyticsJson): Record<string, unknown> {
  const defaultValue =
    payload.defaultValue && typeof payload.defaultValue === "object"
      ? (payload.defaultValue as GoogleAnalyticsJson)
      : {};
  return {
    name: payload.name,
    eventName: payload.eventName,
    createTime: payload.createTime,
    countingMethod: payload.countingMethod,
    custom: payload.custom,
    deletable: payload.deletable,
    defaultValue: {
      currencyCode: defaultValue.currencyCode,
    },
  };
}

export function sanitizeAttribution(payload: GoogleAnalyticsJson): Record<string, unknown> {
  return pick(payload, [
    "name",
    "acquisitionConversionEventLookbackWindow",
    "otherConversionEventLookbackWindow",
    "reportingAttributionModel",
    "adsWebConversionDataExportScope",
  ]);
}

export function sanitizeReportingIdentity(
  payload: GoogleAnalyticsJson,
): Record<string, unknown> {
  return pick(payload, ["name", "reportingIdentity"]);
}

export function sanitizeAdsLink(payload: GoogleAnalyticsJson): Record<string, unknown> {
  return pick(payload, [
    "name",
    "customerId",
    "canManageClients",
    "adsPersonalizationEnabled",
    "createTime",
    "updateTime",
  ]);
}

export function sanitizeCustomDimension(
  payload: GoogleAnalyticsJson,
): Record<string, unknown> | undefined {
  const parameterName =
    typeof payload.parameterName === "string" ? payload.parameterName : "";
  const apiName = `customEvent:${parameterName}`;
  if (
    isForbiddenDimension(parameterName) ||
    isForbiddenDimension(apiName) ||
    FORBIDDEN_CUSTOM_DIMENSION_NAMES.includes(
      parameterName as (typeof FORBIDDEN_CUSTOM_DIMENSION_NAMES)[number],
    )
  ) {
    return {
      name: payload.name,
      parameterName,
      displayName: payload.displayName,
      scope: payload.scope,
      excluded: true,
    };
  }
  return pick(payload, [
    "name",
    "parameterName",
    "displayName",
    "description",
    "scope",
    "disallowAdsPersonalization",
  ]);
}

export function sanitizeCustomMetric(
  payload: GoogleAnalyticsJson,
): Record<string, unknown> {
  return pick(payload, [
    "name",
    "parameterName",
    "displayName",
    "description",
    "scope",
    "measurementUnit",
  ]);
}

export function assertNoSecrets(payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const banned of [
    "access_token",
    "refresh_token",
    "client_secret",
    "authorization",
    "creatorEmailAddress",
    "creatoremailaddress",
    "measurement_protocol",
    "api_secret",
    "apisecret",
  ]) {
    if (serialized.includes(banned.toLowerCase())) {
      throw new Error("snapshot_contains_secret");
    }
  }
}

function sanitizeReportRow(row: GoogleAnalyticsJson): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REPORT_ROW_KEYS) {
    if (key in row) {
      out[key] = row[key];
    }
  }
  return out;
}

function sanitizeQuota(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const quota = value as GoogleAnalyticsJson;
  const out: Record<string, unknown> = {};
  for (const key of [
    "tokensPerDay",
    "tokensPerHour",
    "tokensPerProjectPerHour",
    "concurrentRequests",
    "potentiallyThresholdedRequestsPerHour",
  ]) {
    const item = quota[key];
    if (item && typeof item === "object") {
      const status = item as GoogleAnalyticsJson;
      out[key] = {
        consumed: status.consumed,
        remaining: status.remaining,
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pick(
  payload: GoogleAnalyticsJson,
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
