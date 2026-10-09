import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHistoricalMetaAdsRange,
  lastCompletedDate,
  todayInTimeZone,
} from "./meta-ads.range";

const TORONTO = "America/Toronto";

test("rejects the current Toronto reporting day and future dates", () => {
  const now = new Date("2026-10-06T20:00:00Z");
  assert.equal(todayInTimeZone(TORONTO, now), "2026-10-06");
  assert.equal(lastCompletedDate(TORONTO, now), "2026-10-05");
  assert.throws(
    () => assertHistoricalMetaAdsRange("2026-09-30", "2026-10-06", TORONTO, now),
    /meta_ads_range_includes_current_or_future_day/,
  );
  assert.doesNotThrow(() =>
    assertHistoricalMetaAdsRange("2026-09-30", "2026-10-05", TORONTO, now),
  );
});

test("uses America/Toronto civil dates not Pacific", () => {
  const lateUtc = new Date("2026-10-07T06:30:00Z");
  assert.equal(todayInTimeZone("America/Los_Angeles", lateUtc), "2026-10-06");
  assert.equal(todayInTimeZone(TORONTO, lateUtc), "2026-10-07");
});
