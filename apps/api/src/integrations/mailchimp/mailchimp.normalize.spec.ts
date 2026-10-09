import assert from "node:assert/strict";
import test from "node:test";
import { mockActivity, mockClick, mockGrowth } from "./mailchimp.fixtures";
import {
  normalizeActivityDay,
  normalizeClickDetail,
  normalizeGrowthMonth,
} from "./mailchimp.normalize";

test("normalizes growth months and activity days", () => {
  const month = normalizeGrowthMonth("list001abc", mockGrowth);
  assert.equal(month.month, "2026-09");
  assert.equal(month.subscribed, 118);
  const day = normalizeActivityDay("list001abc", mockActivity);
  assert.equal(day.day, "2026-09-30");
  assert.equal(day.uniqueOpens, 40);
});

test("normalizes aggregate click details", () => {
  const link = normalizeClickDetail("camp001", mockClick);
  assert.equal(link.linkId, "link001");
  assert.equal(link.totalClicks, 7);
});
