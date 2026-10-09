import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHistoricalMailchimpRange,
  civilDateInTimeZone,
  lastCompletedDate,
  monthsOverlappingRange,
  todayInTimeZone,
} from "./mailchimp.range";

const NOW = new Date("2026-10-06T20:00:00Z");

test("rejects the current Toronto reporting day and future dates", () => {
  assert.throws(
    () =>
      assertHistoricalMailchimpRange("2026-09-30", "2026-10-06", "America/Toronto", NOW),
    /mailchimp_range_includes_current_or_future_day/,
  );
});

test("uses America/Toronto civil dates not Pacific", () => {
  assert.doesNotThrow(() =>
    assertHistoricalMailchimpRange("2026-09-30", "2026-10-05", "America/Toronto", NOW),
  );
});

test("months overlapping a range include both ends", () => {
  assert.deepEqual(monthsOverlappingRange("2026-09-30", "2026-10-04"), [
    "2026-09",
    "2026-10",
  ]);
});

test("Toronto and New York civil dates match across 2026 DST transitions", () => {
  const instants = [
    "2026-03-08T04:59:00Z",
    "2026-03-08T05:00:00Z",
    "2026-03-08T06:59:00Z",
    "2026-03-08T07:00:00Z",
    "2026-11-01T03:59:00Z",
    "2026-11-01T04:00:00Z",
    "2026-11-01T06:00:00Z",
    "2026-11-01T07:00:00Z",
  ];
  for (const iso of instants) {
    const now = new Date(iso);
    const toronto = todayInTimeZone("America/Toronto", now);
    const york = todayInTimeZone("America/New_York", now);
    assert.equal(toronto, york, iso);
    assert.equal(civilDateInTimeZone(iso, "America/Toronto"), toronto);
    assert.equal(civilDateInTimeZone(iso, "America/New_York"), york);
  }
  assert.equal(todayInTimeZone("America/Toronto", new Date("2026-03-08T04:59:00Z")), "2026-03-07");
  assert.equal(todayInTimeZone("America/Toronto", new Date("2026-03-08T05:00:00Z")), "2026-03-08");
  assert.equal(todayInTimeZone("America/Toronto", new Date("2026-11-01T03:59:00Z")), "2026-10-31");
  assert.equal(todayInTimeZone("America/Toronto", new Date("2026-11-01T04:00:00Z")), "2026-11-01");
});

test("canonical last completed date stays America/Toronto at DST day boundaries", () => {
  const spring = new Date("2026-03-08T05:30:00Z");
  assert.equal(todayInTimeZone("America/Toronto", spring), "2026-03-08");
  assert.equal(lastCompletedDate("America/Toronto", spring), "2026-03-07");
  assert.equal(lastCompletedDate("America/New_York", spring), "2026-03-07");
  const pacificStillSeventh = todayInTimeZone(
    "America/Los_Angeles",
    spring,
  );
  assert.equal(pacificStillSeventh, "2026-03-07");
});
