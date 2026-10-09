import assert from "node:assert/strict";
import test from "node:test";
import {
  planMailchimpActivityReplacement,
  planMailchimpLinkReplacement,
  planMailchimpReportReplacement,
} from "./mailchimp.replace";

test("activity replacement is limited to published dates", () => {
  const plan = planMailchimpActivityReplacement({
    listId: "list001abc",
    publishedDates: ["2026-09-30"],
    possiblyUnpublishedDates: ["2026-10-01"],
  });
  assert.deepEqual(plan.replaceDates, ["2026-09-30"]);
  assert.deepEqual(plan.skippedUnpublishedDates, ["2026-10-01"]);
});

test("unpublished empty activity does not plan a wipe", () => {
  const plan = planMailchimpActivityReplacement({
    listId: "list001abc",
    publishedDates: [],
    possiblyUnpublishedDates: ["2026-10-04"],
  });
  assert.deepEqual(plan.replaceDates, []);
});

test("missing campaign reports are skipped instead of wiping", () => {
  const plan = planMailchimpReportReplacement({
    sentCampaignIds: ["camp001", "camp002"],
    reportedCampaignIds: ["camp001"],
  });
  assert.deepEqual(plan.replaceCampaignIds, ["camp001"]);
  assert.deepEqual(plan.skippedMissingReportIds, ["camp002"]);
});

test("revised metrics still replace the reported campaign id", () => {
  const first = planMailchimpReportReplacement({
    sentCampaignIds: ["camp001"],
    reportedCampaignIds: ["camp001"],
  });
  const again = planMailchimpReportReplacement({
    sentCampaignIds: ["camp001"],
    reportedCampaignIds: ["camp001"],
  });
  assert.deepEqual(first.replaceCampaignIds, again.replaceCampaignIds);
});

test("empty click details with unique clicks do not plan a link wipe", () => {
  const skipped = planMailchimpLinkReplacement({
    campaignId: "camp001",
    uniqueClicks: 12,
    detailCount: 0,
  });
  assert.equal(skipped.replace, false);
  assert.equal(skipped.skippedIncomplete, true);
  const zero = planMailchimpLinkReplacement({
    campaignId: "camp001",
    uniqueClicks: 0,
    detailCount: 0,
  });
  assert.equal(zero.replace, true);
});
