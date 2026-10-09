import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMailchimpWindowReconciliation } from "./mailchimp.reconcile";

test("row-count mismatches are hard gates", () => {
  const verdict = evaluateMailchimpWindowReconciliation({
    rangeLabel: "2026-09-30/2026-09-30",
    audienceCount: 1,
    activityRows: 1,
    providerActivityCount: 2,
    campaignCount: 1,
    reportCount: 1,
    missingReportCount: 0,
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
  });
  assert.equal(verdict.passed, false);
});

test("unpublished dates and missing reports are diagnostics", () => {
  const verdict = evaluateMailchimpWindowReconciliation({
    rangeLabel: "2026-09-30/2026-10-01",
    audienceCount: 1,
    activityRows: 1,
    providerActivityCount: 1,
    campaignCount: 2,
    reportCount: 1,
    missingReportCount: 1,
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: ["2026-10-01"],
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("2026-10-01")));
  assert.ok(verdict.diagnostics.some((line) => line.includes("missing campaign reports")));
});

test("incomplete click details are diagnostics and not a wipe gate", () => {
  const verdict = evaluateMailchimpWindowReconciliation({
    rangeLabel: "2026-09-22/2026-10-19",
    audienceCount: 1,
    activityRows: 0,
    providerActivityCount: 0,
    campaignCount: 1,
    reportCount: 1,
    missingReportCount: 0,
    publishedDates: [],
    possiblyUnpublishedDates: [],
    skippedIncompleteLinkCount: 1,
  });
  assert.equal(verdict.passed, true);
  assert.ok(verdict.diagnostics.some((line) => line.includes("incomplete click details")));
});
