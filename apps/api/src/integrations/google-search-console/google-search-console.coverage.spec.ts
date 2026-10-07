import assert from "node:assert/strict";
import test from "node:test";
import { classifyGscWindowCoverage, factsForDates } from "./google-search-console.coverage";
import type { NormalizedGscFact } from "./google-search-console.normalize";

function fact(date: string, family: NormalizedGscFact["family"] = "daily_totals"): NormalizedGscFact {
  return {
    family,
    gscDate: date,
    dimensions: {},
    metrics: { clicks: "1", impressions: "10", ctr: "0.1", position: "4" },
  };
}

test("dates with any returned final rows are published", () => {
  const coverage = classifyGscWindowCoverage({
    from: "2026-09-30",
    to: "2026-10-04",
    factsByFamily: {
      daily_totals: [fact("2026-09-30"), fact("2026-10-01")],
      query: [fact("2026-10-01", "query")],
    },
  });
  assert.deepEqual(coverage.publishedDates, ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(coverage.possiblyUnpublishedDates, [
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
});

test("an empty window is entirely possibly unpublished, not a canonical zero", () => {
  const coverage = classifyGscWindowCoverage({
    from: "2026-10-05",
    to: "2026-10-05",
    factsByFamily: { daily_totals: [], query: [], page: [] },
  });
  assert.deepEqual(coverage.publishedDates, []);
  assert.deepEqual(coverage.possiblyUnpublishedDates, ["2026-10-05"]);
});

test("two-day-old emptiness is still unpublished without returned rows", () => {
  const coverage = classifyGscWindowCoverage({
    from: "2026-10-04",
    to: "2026-10-04",
    factsByFamily: { daily_totals: [] },
  });
  assert.deepEqual(coverage.publishedDates, []);
  assert.deepEqual(coverage.possiblyUnpublishedDates, ["2026-10-04"]);
});

test("factsForDates drops unpublished dates", () => {
  const kept = factsForDates(
    [fact("2026-09-30"), fact("2026-10-05")],
    ["2026-09-30"],
  );
  assert.deepEqual(kept.map((item) => item.gscDate), ["2026-09-30"]);
});
