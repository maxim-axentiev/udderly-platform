import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReportPayload, parseMetric } from "./google-analytics.normalize";
import { GA_REPORT_DEFINITIONS } from "./google-analytics.reports";

function payload(
  family: string,
  rows: Array<{ dimensions: string[]; metrics: string[] }>,
  extra?: Partial<{ quality: Record<string, boolean> }>,
) {
  const definition = GA_REPORT_DEFINITIONS.find((item) => item.id === family);
  assert.ok(definition);
  return {
    family,
    dimensionHeaders: definition.dimensions,
    metricHeaders: definition.metrics,
    quality: extra?.quality ?? {
      sampled: false,
      dataLossFromOtherRow: false,
      subjectToThresholding: false,
    },
    rows: rows.map((row) => ({
      dimensionValues: row.dimensions.map((value) => ({ value })),
      metricValues: row.metrics.map((value) => ({ value })),
    })),
  };
}

test("normalizes each report family", () => {
  const samples: Record<string, { dimensions: string[]; metrics: string[] }> = {
    daily_totals: {
      dimensions: ["20230401"],
      metrics: ["1", "2", "3", "4", "0.5", "0.4", "10", "11", "1", "30"],
    },
    daily_engagement: { dimensions: ["20230401"], metrics: ["12", "3"] },
    ecommerce_totals: { dimensions: ["20230401"], metrics: ["1", "1", "12.5", "2", "3"] },
    session_acquisition: {
      dimensions: ["20230401", "google", "organic", "Organic Search"],
      metrics: ["4", "3", "1", "0.2"],
    },
    first_user_acquisition: {
      dimensions: ["20230401", "google", "organic", "Organic Search"],
      metrics: ["2", "3"],
    },
    landing_page: { dimensions: ["20230401", "/goats/"], metrics: ["4", "3", "1", "2"] },
    page_path: { dimensions: ["20230401", "/goats/"], metrics: ["9", "8", "2"] },
    event: { dimensions: ["20230401", "purchase"], metrics: ["5", "2", "1"] },
    country: { dimensions: ["20230401", "Canada"], metrics: ["4", "3"] },
    device: { dimensions: ["20230401", "mobile"], metrics: ["4", "3", "2"] },
    ecommerce_item: { dimensions: ["20230401", "sku-1"], metrics: ["9", "2", "1", "12.5"] },
  };
  for (const definition of GA_REPORT_DEFINITIONS) {
    const sample = samples[definition.id];
    const facts = normalizeReportPayload(payload(definition.id, [sample]));
    assert.equal(facts.length, 1);
    assert.equal(facts[0].farmDate, "2023-04-01");
    assert.equal(facts[0].family, definition.canonicalFamily);
  }
});

test("parses zero, missing, (not set), and (other)", () => {
  assert.equal(parseMetric("0"), "0");
  assert.throws(() => parseMetric(""), /malformed_metric/);
  const notSet = normalizeReportPayload(
    payload("session_acquisition", [
      {
        dimensions: ["20230401", "(not set)", "(not set)", "(not set)"],
        metrics: ["0", "0", "0", "0"],
      },
    ]),
  );
  assert.equal(notSet[0].dimensions.sessionSource, "(not set)");
  const other = normalizeReportPayload(
    payload("country", [
      { dimensions: ["20230401", "(other)"], metrics: ["1", "1"] },
    ]),
  );
  assert.equal(other[0].dimensions.country, "(other)");
  assert.equal(normalizeReportPayload(payload("country", [])).length, 0);
});

test("fails duplicate keys, malformed dates, unknown family, and excluded dimensions", () => {
  assert.throws(
    () =>
      normalizeReportPayload(
        payload("country", [
          { dimensions: ["20230401", "Canada"], metrics: ["1", "1"] },
          { dimensions: ["20230401", "Canada"], metrics: ["2", "2"] },
        ]),
      ),
    /duplicate_dimension_key/,
  );
  assert.throws(
    () =>
      normalizeReportPayload(
        payload("country", [{ dimensions: ["not-a-date", "Canada"], metrics: ["1", "1"] }]),
      ),
    /malformed_ga_date|invalid_date/,
  );
  assert.throws(
    () =>
      normalizeReportPayload({
        family: "ads_campaign",
        dimensionHeaders: ["date"],
        metricHeaders: ["sessions"],
        rows: [],
      }),
    /unknown_report_family/,
  );
  assert.throws(
    () =>
      normalizeReportPayload({
        family: "event",
        dimensionHeaders: ["date", "customEvent:email_address"],
        metricHeaders: ["eventCount", "activeUsers", "keyEvents"],
        rows: [],
      }),
    /forbidden_dimension/,
  );
});

test("does not reinterpret YYYYMMDD as a UTC calendar shift", () => {
  const facts = normalizeReportPayload(
    payload("daily_totals", [
      {
        dimensions: ["20230401"],
        metrics: ["1", "1", "1", "1", "1", "1", "1", "1", "1", "1"],
      },
    ]),
  );
  assert.equal(facts[0].farmDate, "2023-04-01");
});
