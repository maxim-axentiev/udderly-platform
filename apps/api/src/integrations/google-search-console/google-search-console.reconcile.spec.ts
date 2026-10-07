import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedGscFact } from "./google-search-console.normalize";
import {
  evaluateGscWindowReconciliation,
  sumMetric,
} from "./google-search-console.reconcile";

function family(
  name: string,
  extras: Partial<{ sourceRows: number; providerRowCount: number; canonicalRows: number }> = {},
) {
  return {
    family: name,
    startDate: "2026-09-30",
    endDate: "2026-09-30",
    sourceRows: extras.sourceRows ?? 1,
    providerRowCount: extras.providerRowCount ?? extras.sourceRows ?? 1,
    canonicalRows: extras.canonicalRows ?? extras.sourceRows ?? 1,
    unresolvedRows: 0,
    requestCount: 1,
    dataState: "final",
    searchType: "web",
  };
}

function fact(clicks: string): NormalizedGscFact {
  return {
    family: "query",
    gscDate: "2026-09-30",
    dimensions: { query: "farm" },
    metrics: { clicks, impressions: "10", ctr: "0.1", position: "5" },
  };
}

test("query page and search appearance mismatches are diagnostics", () => {
  const verdict = evaluateGscWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    families: [family("daily_totals"), family("query", { sourceRows: 0 })],
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
    dailyClicks: "10",
    dailyImpressions: "100",
    queryClicks: "0",
    queryImpressions: "0",
    pageClicks: "8",
    pageImpressions: "90",
    searchAppearanceClicks: "3",
    searchAppearanceImpressions: "40",
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("query clicks")));
  assert.ok(verdict.diagnostics.some((line) => line.includes("page clicks")));
  assert.ok(verdict.diagnostics.some((line) => line.includes("search_appearance clicks")));
  assert.equal(verdict.differences.length, 0);
});

test("country and device mismatches are also diagnostics", () => {
  const verdict = evaluateGscWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    families: [family("daily_totals"), family("country"), family("device")],
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
    dailyClicks: "10",
    countryClicks: "9",
    deviceClicks: "11",
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("country clicks")));
  assert.ok(verdict.diagnostics.some((line) => line.includes("device clicks")));
});

test("unpublished dates are diagnostics and do not fail", () => {
  const verdict = evaluateGscWindowReconciliation({
    rangeLabel: "2026-10-04/2026-10-04",
    families: [family("daily_totals", { sourceRows: 0 })],
    publishedDates: [],
    possiblyUnpublishedDates: ["2026-10-04"],
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("2026-10-04")));
});

test("pagination and quality mismatches are hard gates", () => {
  const verdict = evaluateGscWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    families: [
      family("query", { sourceRows: 1, providerRowCount: 2 }),
      {
        ...family("page"),
        dataState: "all",
      },
    ],
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.differences.some((line) => line.includes("rowCount")));
  assert.ok(verdict.differences.some((line) => line.includes("non_final")));
});

test("sumMetric does not invent clicks when the family was not imported", () => {
  assert.equal(sumMetric(undefined, "clicks"), undefined);
  assert.equal(sumMetric([], "clicks"), "0");
  assert.equal(sumMetric([fact("2"), fact("3")], "clicks"), "5");
});
