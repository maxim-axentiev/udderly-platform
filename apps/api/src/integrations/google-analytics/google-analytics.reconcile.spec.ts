import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedFact } from "./google-analytics.normalize";
import {
  evaluateGaFamilyReconciliation,
  evaluateGaWindowReconciliation,
  sumMetric,
  type GaFamilyReconcileTotals,
} from "./google-analytics.reconcile";

function family(
  name: string,
  extra: Partial<GaFamilyReconcileTotals> = {},
): GaFamilyReconcileTotals {
  return {
    family: name,
    startDate: "2022-06-01",
    endDate: "2022-06-30",
    sourceRows: 0,
    providerRowCount: 0,
    canonicalRows: 0,
    unresolvedRows: 0,
    requestCount: 1,
    sampled: false,
    dataLossFromOtherRow: false,
    subjectToThresholding: false,
    ...extra,
  };
}

test("PASS for a valid no-data tracking-gap month", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2022-06",
    families: [family("daily_totals"), family("event")],
  });
  assert.equal(verdict.passed, true);
  assert.deepEqual(evaluateGaFamilyReconciliation(family("daily_totals")), []);
});

test("FAIL on row mismatch", () => {
  const differences = evaluateGaFamilyReconciliation(
    family("event", { sourceRows: 2, providerRowCount: 3, canonicalRows: 2 }),
  );
  assert.ok(differences.some((item) => item.includes("rowCount")));
});

test("FAIL on unresolved rows", () => {
  const differences = evaluateGaFamilyReconciliation(
    family("event", { sourceRows: 1, providerRowCount: 1, canonicalRows: 1, unresolvedRows: 1 }),
  );
  assert.ok(differences.some((item) => item.includes("unresolved")));
});

test("thresholding is not reported as unresolved", () => {
  const differences = evaluateGaFamilyReconciliation(
    family("event", { subjectToThresholding: true }),
  );
  assert.ok(
    differences.some((item) =>
      item.includes("google_analytics_provider_thresholded_data_suppressed"),
    ),
  );
  assert.ok(!differences.some((item) => item.includes("unresolved")));
});

test("additive cross-family session and eventCount checks", () => {
  const daily: NormalizedFact[] = [
    {
      family: "daily_totals",
      farmDate: "2023-04-01",
      dimensions: {},
      metrics: { sessions: "10", eventCount: "20", activeUsers: "8" },
    },
  ];
  const acquisition: NormalizedFact[] = [
    {
      family: "session_acquisition",
      farmDate: "2023-04-01",
      dimensions: { sessionSource: "google" },
      metrics: { sessions: "6" },
    },
    {
      family: "session_acquisition",
      farmDate: "2023-04-01",
      dimensions: { sessionSource: "direct" },
      metrics: { sessions: "4" },
    },
  ];
  const events: NormalizedFact[] = [
    {
      family: "event",
      farmDate: "2023-04-01",
      dimensions: { eventName: "page_view" },
      metrics: { eventCount: "12" },
    },
    {
      family: "event",
      farmDate: "2023-04-01",
      dimensions: { eventName: "purchase" },
      metrics: { eventCount: "8" },
    },
  ];
  const pass = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-01",
    families: [
      family("daily_totals", {
        startDate: "2023-04-01",
        endDate: "2023-04-01",
        sourceRows: 1,
        providerRowCount: 1,
        canonicalRows: 1,
      }),
      family("session_acquisition", {
        startDate: "2023-04-01",
        endDate: "2023-04-01",
        sourceRows: 2,
        providerRowCount: 2,
        canonicalRows: 2,
      }),
      family("event", {
        startDate: "2023-04-01",
        endDate: "2023-04-01",
        sourceRows: 2,
        providerRowCount: 2,
        canonicalRows: 2,
      }),
    ],
    dailySessions: sumMetric(daily, "sessions"),
    acquisitionSessions: sumMetric(acquisition, "sessions"),
    eventCount: sumMetric(daily, "eventCount"),
    eventFamilyEventCount: sumMetric(events, "eventCount"),
  });
  assert.equal(pass.passed, true);

  const fail = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-01",
    families: pass.totals.families,
    dailySessions: "10",
    acquisitionSessions: "9",
  });
  assert.equal(fail.passed, false);
});

test("does not treat active users as additive", () => {
  assert.equal(
    sumMetric(
      [
        {
          family: "country",
          farmDate: "2023-04-01",
          dimensions: { country: "Canada" },
          metrics: { activeUsers: "3" },
        },
      ],
      "activeUsers",
    ),
    undefined,
  );
});

test("literal (other) rows are included in additive session sums", () => {
  const total = sumMetric(
    [
      {
        family: "session_acquisition",
        farmDate: "2023-04-01",
        dimensions: { sessionSource: "google" },
        metrics: { sessions: "8" },
      },
      {
        family: "session_acquisition",
        farmDate: "2023-04-01",
        dimensions: { sessionSource: "(other)" },
        metrics: { sessions: "2" },
      },
    ],
    "sessions",
  );
  assert.equal(total, "10");
});

test("missing ecommerce facts do not become zero for additive checks", () => {
  assert.equal(sumMetric([], "ecommercePurchases"), undefined);
});
