import { qualityFailure } from "./google-analytics.quality";
import { gaDateToFarmDate } from "./google-analytics.range";
import type { GaCanonicalFamily } from "./google-analytics.reports";
import {
  assertSafeDimensions,
  reportDefinition,
} from "./google-analytics.reports";
import type { GoogleAnalyticsJson } from "./google-analytics.types";

export type NormalizedFact = {
  family: GaCanonicalFamily;
  farmDate: string;
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
};

export function normalizeReportPayload(
  payload: Record<string, unknown>,
): NormalizedFact[] {
  const family = payload.family;
  if (typeof family !== "string") {
    throw new Error("unknown_report_family");
  }
  const definition = reportDefinition(family);
  assertSafeDimensions(definition.dimensions);
  const quality = payload.quality as
    | { sampled?: boolean; dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean }
    | undefined;
  const qualityError = quality
    ? qualityFailure({
        sampled: quality.sampled === true,
        dataLossFromOtherRow: quality.dataLossFromOtherRow === true,
        subjectToThresholding: quality.subjectToThresholding === true,
      })
    : undefined;
  if (qualityError) {
    throw new Error(qualityError);
  }

  const dimensionHeaders = asStringArray(payload.dimensionHeaders);
  const metricHeaders = asStringArray(payload.metricHeaders);
  assertSafeDimensions(dimensionHeaders);
  if (
    JSON.stringify(dimensionHeaders) !== JSON.stringify(definition.dimensions) ||
    JSON.stringify(metricHeaders) !== JSON.stringify(definition.metrics)
  ) {
    throw new Error("report_headers_mismatch");
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const facts: NormalizedFact[] = [];
  const keys = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("malformed_row");
    }
    const fact = normalizeRow(
      definition.canonicalFamily,
      dimensionHeaders,
      metricHeaders,
      row as GoogleAnalyticsJson,
    );
    const key = `${fact.farmDate}|${JSON.stringify(fact.dimensions)}`;
    if (keys.has(key)) {
      throw new Error("duplicate_dimension_key");
    }
    keys.add(key);
    facts.push(fact);
  }

  return facts;
}

function normalizeRow(
  family: GaCanonicalFamily,
  dimensionHeaders: string[],
  metricHeaders: string[],
  row: GoogleAnalyticsJson,
): NormalizedFact {
  const dimValues = Array.isArray(row.dimensionValues)
    ? (row.dimensionValues as GoogleAnalyticsJson[])
    : [];
  const metricValues = Array.isArray(row.metricValues)
    ? (row.metricValues as GoogleAnalyticsJson[])
    : [];
  if (dimValues.length !== dimensionHeaders.length) {
    throw new Error("malformed_row");
  }
  if (metricValues.length !== metricHeaders.length) {
    throw new Error("malformed_row");
  }

  const dimensions: Record<string, string> = {};
  let farmDate: string | undefined;
  for (let i = 0; i < dimensionHeaders.length; i += 1) {
    const header = dimensionHeaders[i];
    const value = dimValues[i]?.value;
    if (typeof value !== "string") {
      throw new Error("malformed_row");
    }
    if (header === "date") {
      farmDate = gaDateToFarmDate(value);
    } else {
      dimensions[header] = value;
    }
  }
  if (!farmDate) {
    throw new Error("malformed_ga_date");
  }

  const metrics: Record<string, string> = {};
  for (let i = 0; i < metricHeaders.length; i += 1) {
    metrics[metricHeaders[i]] = parseMetric(metricValues[i]?.value);
  }

  return { family, farmDate, dimensions, metrics };
}

export function parseMetric(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("malformed_metric");
  }
  const text = String(value);
  if (text.trim() === "") {
    throw new Error("malformed_metric");
  }
  const number = Number(text);
  if (!Number.isFinite(number)) {
    throw new Error("malformed_metric");
  }
  return text;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("malformed_row");
  }
  return value as string[];
}
