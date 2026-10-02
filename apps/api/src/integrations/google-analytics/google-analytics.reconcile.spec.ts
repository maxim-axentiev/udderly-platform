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

const completeDaily = family("daily_totals", {
  startDate: "2023-04-04",
  endDate: "2023-04-04",
  sourceRows: 1,
  providerRowCount: 1,
  canonicalRows: 1,
});

const completeAcquisition = family("session_acquisition", {
  startDate: "2023-04-04",
  endDate: "2023-04-04",
  sourceRows: 17,
  providerRowCount: 17,
  canonicalRows: 17,
});

const completeEvents = family("event", {
  startDate: "2023-04-04",
  endDate: "2023-04-04",
  sourceRows: 2,
  providerRowCount: 2,
  canonicalRows: 2,
});

test("PASS for a valid no-data tracking-gap month", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2022-06",
    families: [family("daily_totals"), family("event")],
  });
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.diagnostics, []);
  assert.deepEqual(evaluateGaFamilyReconciliation(family("daily_totals")), []);
});

test("FAIL on row mismatch", () => {
  const differences = evaluateGaFamilyReconciliation(
    family("event", { sourceRows: 2, providerRowCount: 3, canonicalRows: 2 }),
  );
  assert.ok(differences.some((item) => item.includes("rowCount")));
});

test("session-acquisition source vs canonical row counts remain fail-closed", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [
      completeDaily,
      family("session_acquisition", {
        startDate: "2023-04-04",
        endDate: "2023-04-04",
        sourceRows: 17,
        providerRowCount: 16,
        canonicalRows: 17,
      }),
    ],
    dailySessions: "170",
    acquisitionSessions: "171",
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.differences.some((item) => item.includes("rowCount")));
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

test("FAIL on sampling", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [family("daily_totals", { sampled: true })],
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.differences.some((item) => item.includes("google_analytics_sampled_report")));
});

test("FAIL on dataLossFromOtherRow", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [family("page_path", { dataLossFromOtherRow: true })],
  });
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.differences.some((item) => item.includes("google_analytics_data_loss_from_other_row")),
  );
});

test("production 2023-04-04 sessions 170 vs acquisition 171 PASSes with diagnostic", () => {
  const daily: NormalizedFact[] = [
    {
      family: "daily_totals",
      farmDate: "2023-04-04",
      dimensions: {},
      metrics: { sessions: "170", eventCount: "20" },
    },
  ];
  const acquisition: NormalizedFact[] = [
    {
      family: "session_acquisition",
      farmDate: "2023-04-04",
      dimensions: { sessionSource: "google" },
      metrics: { sessions: "100" },
    },
    {
      family: "session_acquisition",
      farmDate: "2023-04-04",
      dimensions: { sessionSource: "direct" },
      metrics: { sessions: "71" },
    },
  ];
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [completeDaily, completeAcquisition],
    dailySessions: sumMetric(daily, "sessions"),
    acquisitionSessions: sumMetric(acquisition, "sessions"),
  });
  assert.equal(sumMetric(daily, "sessions"), "170");
  assert.equal(sumMetric(acquisition, "sessions"), "171");
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.differences, []);
  assert.equal(verdict.diagnostics.length, 1);
  assert.match(verdict.diagnostics[0] ?? "", /sessions diagnostic daily=170 acquisition=171/);
  assert.ok(!verdict.diagnostics.some((item) => /±|percent|toleran/i.test(item)));
});

test("matching daily and acquisition session sums PASS with no diagnostic", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [completeDaily, completeAcquisition],
    dailySessions: "170",
    acquisitionSessions: "170",
  });
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.diagnostics, []);
});

test("eventCount exact match PASSes", () => {
  const daily: NormalizedFact[] = [
    {
      family: "daily_totals",
      farmDate: "2023-04-04",
      dimensions: {},
      metrics: { eventCount: "20" },
    },
  ];
  const events: NormalizedFact[] = [
    {
      family: "event",
      farmDate: "2023-04-04",
      dimensions: { eventName: "page_view" },
      metrics: { eventCount: "12" },
    },
    {
      family: "event",
      farmDate: "2023-04-04",
      dimensions: { eventName: "purchase" },
      metrics: { eventCount: "8" },
    },
  ];
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [completeDaily, completeEvents],
    eventCount: sumMetric(daily, "eventCount"),
    eventFamilyEventCount: sumMetric(events, "eventCount"),
  });
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.differences, []);
});

test("eventCount mismatch FAILs", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [completeDaily, completeEvents],
    eventCount: "20",
    eventFamilyEventCount: "19",
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.differences.some((item) => item.includes("eventCount")));
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

test("literal (other) rows are included in session diagnostic sums", () => {
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

test("literal (other) event rows remain in additive eventCount", () => {
  const verdict = evaluateGaWindowReconciliation({
    rangeLabel: "2023-04-04",
    families: [completeDaily, completeEvents],
    eventCount: "10",
    eventFamilyEventCount: sumMetric(
      [
        {
          family: "event",
          farmDate: "2023-04-04",
          dimensions: { eventName: "page_view" },
          metrics: { eventCount: "8" },
        },
        {
          family: "event",
          farmDate: "2023-04-04",
          dimensions: { eventName: "(other)" },
          metrics: { eventCount: "2" },
        },
      ],
      "eventCount",
    ),
  });
  assert.equal(verdict.passed, true);
});

test("missing ecommerce facts do not become zero for additive checks", () => {
  assert.equal(sumMetric([], "ecommercePurchases"), undefined);
});
