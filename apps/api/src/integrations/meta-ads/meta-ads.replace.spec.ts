import assert from "node:assert/strict";
import test from "node:test";
import { META_ADS_CANONICAL_ACCOUNT_ID } from "./meta-ads.constants";
import { planMetaAdsFamilyReplacement } from "./meta-ads.replace";

test("replacement is limited to published dates for one account", () => {
  const plan = planMetaAdsFamilyReplacement({
    level: "campaign",
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    publishedDates: ["2026-09-30", "2026-10-01"],
    possiblyUnpublishedDates: ["2026-10-02"],
  });
  assert.deepEqual(plan.replaceDates, ["2026-09-30", "2026-10-01"]);
  assert.deepEqual(plan.skippedUnpublishedDates, ["2026-10-02"]);
});

test("empty campaign coverage does not replace a date published only at account level", () => {
  const plan = planMetaAdsFamilyReplacement({
    level: "campaign",
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    publishedDates: [],
    possiblyUnpublishedDates: ["2026-09-30"],
  });
  assert.deepEqual(plan.replaceDates, []);
});

test("unpublished empty insights do not plan a wipe", () => {
  const plan = planMetaAdsFamilyReplacement({
    level: "account",
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    publishedDates: [],
    possiblyUnpublishedDates: ["2026-10-04"],
  });
  assert.deepEqual(plan.replaceDates, []);
  assert.deepEqual(plan.skippedUnpublishedDates, ["2026-10-04"]);
});
