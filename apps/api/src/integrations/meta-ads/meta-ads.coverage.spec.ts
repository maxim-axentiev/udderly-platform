import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMetaAdsWindowCoverage,
  factsForDates,
  incompleteLevelCoverageDiagnostics,
  publishedDatesForFacts,
} from "./meta-ads.coverage";
import type { NormalizedMetaAdsFact } from "./meta-ads.normalize";

function fact(date: string, level: NormalizedMetaAdsFact["level"] = "account"): NormalizedMetaAdsFact {
  return {
    level,
    metricDate: date,
    objectId: "1",
    attributionWindow: "7d_click,1d_view",
    spendAmount: 100,
    currency: "CAD",
    impressions: "10",
    clicks: "1",
  };
}

test("dates with any returned insight rows are published globally", () => {
  const coverage = classifyMetaAdsWindowCoverage({
    from: "2026-09-30",
    to: "2026-10-02",
    factsByLevel: {
      account: [fact("2026-09-30")],
      campaign: [fact("2026-10-01", "campaign")],
    },
  });
  assert.deepEqual(coverage.publishedDates, ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(coverage.possiblyUnpublishedDates, ["2026-10-02"]);
  assert.deepEqual(coverage.publishedDatesByLevel.account, ["2026-09-30"]);
  assert.deepEqual(coverage.publishedDatesByLevel.campaign, ["2026-10-01"]);
});

test("an empty window is entirely possibly unpublished", () => {
  const coverage = classifyMetaAdsWindowCoverage({
    from: "2026-10-05",
    to: "2026-10-05",
    factsByLevel: { account: [], campaign: [] },
  });
  assert.deepEqual(coverage.publishedDates, []);
  assert.deepEqual(coverage.possiblyUnpublishedDates, ["2026-10-05"]);
});

test("factsForDates drops unpublished dates", () => {
  const kept = factsForDates(
    [fact("2026-09-30"), fact("2026-10-05")],
    ["2026-09-30"],
  );
  assert.deepEqual(
    kept.map((item) => item.metricDate),
    ["2026-09-30"],
  );
});

test("incomplete campaign coverage does not inherit account published dates", () => {
  const account = [fact("2026-09-30"), fact("2026-10-01")];
  const campaign = [fact("2026-09-30", "campaign")];
  assert.deepEqual(publishedDatesForFacts(account), ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(publishedDatesForFacts(campaign), ["2026-09-30"]);
  const diagnostics = incompleteLevelCoverageDiagnostics({ account, campaign });
  assert.ok(
    diagnostics.some((line) =>
      line.includes("campaign incomplete coverage date=2026-10-01"),
    ),
  );
});
