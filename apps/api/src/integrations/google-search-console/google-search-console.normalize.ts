import { qualityFailure } from "./google-search-console.quality";
import { assertGscDate } from "./google-search-console.range";
import {
  reportDefinition,
  type GscReportFamilyId,
} from "./google-search-console.reports";

export type NormalizedGscFact = {
  family: GscReportFamilyId;
  gscDate: string;
  dimensions: Record<string, string>;
  metrics: {
    clicks: string;
    impressions: string;
    ctr: string;
    position: string;
  };
};

export function normalizeReportPayload(
  payload: Record<string, unknown>,
): NormalizedGscFact[] {
  const family = payload.family;
  if (typeof family !== "string") {
    throw new Error("unknown_report_family");
  }
  const definition = reportDefinition(family);
  const qualityError = qualityFailure({
    dataState: typeof payload.dataState === "string" ? payload.dataState : undefined,
    searchType: typeof payload.searchType === "string" ? payload.searchType : undefined,
  });
  if (qualityError) {
    throw new Error(qualityError);
  }

  const dimensions = asStringArray(payload.dimensions);
  if (JSON.stringify(dimensions) !== JSON.stringify(definition.dimensions)) {
    throw new Error("report_headers_mismatch");
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const facts: NormalizedGscFact[] = [];
  const keys = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("malformed_row");
    }
    const fact = normalizeRow(
      definition.id,
      dimensions,
      row as Record<string, unknown>,
      payload,
    );
    const key = `${fact.gscDate}|${JSON.stringify(fact.dimensions)}`;
    if (keys.has(key)) {
      throw new Error("duplicate_dimension_key");
    }
    keys.add(key);
    facts.push(fact);
  }

  return facts;
}

function normalizeRow(
  family: GscReportFamilyId,
  dimensionHeaders: string[],
  row: Record<string, unknown>,
  payload: Record<string, unknown>,
): NormalizedGscFact {
  const keyValues = Array.isArray(row.keys) ? row.keys : [];
  if (keyValues.length !== dimensionHeaders.length) {
    throw new Error("malformed_row");
  }

  const dimensions: Record<string, string> = {};
  let gscDate: string | undefined;
  if (typeof row.gscDate === "string") {
    assertGscDate(row.gscDate);
    gscDate = row.gscDate;
  }
  for (let i = 0; i < dimensionHeaders.length; i += 1) {
    const header = dimensionHeaders[i];
    const value = keyValues[i];
    if (typeof value !== "string") {
      throw new Error("malformed_row");
    }
    if (header === "date") {
      assertGscDate(value);
      gscDate = value;
    } else {
      dimensions[header] = value;
    }
  }
  if (!gscDate && payload.startDate === payload.endDate && typeof payload.startDate === "string") {
    assertGscDate(payload.startDate);
    gscDate = payload.startDate;
  }
  if (!gscDate) {
    throw new Error("malformed_gsc_date");
  }

  return {
    family,
    gscDate,
    dimensions,
    metrics: {
      clicks: parseMetric(row.clicks),
      impressions: parseMetric(row.impressions),
      ctr: parseMetric(row.ctr),
      position: parseMetric(row.position),
    },
  };
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
