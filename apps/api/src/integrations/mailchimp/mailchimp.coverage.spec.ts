import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMailchimpActivityCoverage,
  daysForDates,
} from "./mailchimp.coverage";

test("activity dates with returned rows are published", () => {
  const coverage = classifyMailchimpActivityCoverage({
    from: "2026-09-30",
    to: "2026-10-02",
    activityDays: ["2026-09-30"],
  });
  assert.deepEqual(coverage.publishedDates, ["2026-09-30"]);
  assert.deepEqual(coverage.possiblyUnpublishedDates, ["2026-10-01", "2026-10-02"]);
});

test("an empty window is entirely possibly unpublished", () => {
  const coverage = classifyMailchimpActivityCoverage({
    from: "2026-10-05",
    to: "2026-10-05",
    activityDays: [],
  });
  assert.deepEqual(coverage.publishedDates, []);
  assert.deepEqual(coverage.possiblyUnpublishedDates, ["2026-10-05"]);
});

test("daysForDates drops unpublished dates", () => {
  assert.deepEqual(daysForDates(["2026-09-30", "2026-10-05"], ["2026-09-30"]), [
    "2026-09-30",
  ]);
});
