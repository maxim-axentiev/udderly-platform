import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMetaAdsWindowReconciliation,
  sumSpend,
} from "./meta-ads.reconcile";
import type { NormalizedMetaAdsFact } from "./meta-ads.normalize";

function level(
  name: "account" | "campaign" | "adset" | "ad",
  extras: Partial<{ sourceRows: number; providerRowCount: number; canonicalRows: number }> = {},
) {
  return {
    level: name,
    startDate: "2026-09-30",
    endDate: "2026-09-30",
    sourceRows: extras.sourceRows ?? 1,
    providerRowCount: extras.providerRowCount ?? extras.sourceRows ?? 1,
    canonicalRows: extras.canonicalRows ?? extras.sourceRows ?? 1,
    unresolvedRows: 0,
    requestCount: 1,
    attributionWindow: "7d_click,1d_view",
  };
}

function fact(spendAmount: number): NormalizedMetaAdsFact {
  return {
    level: "campaign",
    metricDate: "2026-09-30",
    objectId: "1",
    attributionWindow: "7d_click,1d_view",
    spendAmount,
    currency: "CAD",
    impressions: "10",
    clicks: "1",
  };
}

test("campaign spend mismatch is a diagnostic not a gate", () => {
  const verdict = evaluateMetaAdsWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    levels: [level("account"), level("campaign")],
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
    accountSpend: 1234,
    campaignSpend: 1200,
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("campaign spend")));
});

test("unpublished dates are diagnostics and do not fail", () => {
  const verdict = evaluateMetaAdsWindowReconciliation({
    rangeLabel: "2026-10-04/2026-10-04",
    levels: [level("account", { sourceRows: 0 })],
    publishedDates: [],
    possiblyUnpublishedDates: ["2026-10-04"],
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("2026-10-04")));
});

test("row-count mismatches are hard gates", () => {
  const verdict = evaluateMetaAdsWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    levels: [level("campaign", { sourceRows: 1, providerRowCount: 2 })],
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.differences.some((line) => line.includes("rowCount")));
});

test("sumSpend does not invent spend when the level was not imported", () => {
  assert.equal(sumSpend(undefined), undefined);
  assert.equal(sumSpend([]), 0);
  assert.equal(sumSpend([fact(100), fact(34)]), 134);
});

test("attribution-window mismatch is a hard gate", () => {
  const verdict = evaluateMetaAdsWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    levels: [{ ...level("account"), attributionWindow: "1d_click" }],
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.differences.some((line) => line.includes("attribution_window_mismatch")));
});
