import assert from "node:assert/strict";
import test from "node:test";
import { GSC_CANONICAL_SITE_URL } from "./google-search-console.constants";
import {
  dateIsInsideReplaceDates,
  planGscFamilyReplacement,
} from "./google-search-console.replace";

test("replacement is limited to published dates for one site", () => {
  const plan = planGscFamilyReplacement({
    family: "query",
    siteUrl: GSC_CANONICAL_SITE_URL,
    publishedDates: ["2026-09-30", "2026-10-01"],
    possiblyUnpublishedDates: ["2026-10-02"],
  });
  assert.deepEqual(plan.replaceDates, ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(plan.skippedUnpublishedDates, ["2026-10-02"]);
  assert.equal(dateIsInsideReplaceDates("2026-10-01", plan.replaceDates), true);
  assert.equal(dateIsInsideReplaceDates("2026-10-02", plan.replaceDates), false);
});

test("authoritative empty query still replaces published dates so stale grains disappear", () => {
  const plan = planGscFamilyReplacement({
    family: "query",
    siteUrl: GSC_CANONICAL_SITE_URL,
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: [],
  });
  assert.deepEqual(plan.replaceDates, ["2026-09-30"]);
});

test("unpublished empty final does not plan a wipe", () => {
  const plan = planGscFamilyReplacement({
    family: "daily_totals",
    siteUrl: GSC_CANONICAL_SITE_URL,
    publishedDates: [],
    possiblyUnpublishedDates: ["2026-10-04"],
  });
  assert.deepEqual(plan.replaceDates, []);
  assert.deepEqual(plan.skippedUnpublishedDates, ["2026-10-04"]);
});
