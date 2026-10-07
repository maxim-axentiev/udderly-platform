import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHistoricalGscRange,
  lastCompletedDate,
  todayInTimeZone,
  weekChunks,
} from "./google-search-console.range";

const PACIFIC = "America/Los_Angeles";

test("rejects dates before canonical GSC history", () => {
  assert.throws(
    () =>
      assertHistoricalGscRange("2026-09-29", "2026-09-30", PACIFIC, new Date("2026-10-06T20:00:00Z")),
    /gsc_range_before_earliest_useful_date/,
  );
});

test("rejects the current Pacific reporting day and future dates", () => {
  const now = new Date("2026-10-06T20:00:00Z");
  assert.equal(todayInTimeZone(PACIFIC, now), "2026-10-06");
  assert.equal(lastCompletedDate(PACIFIC, now), "2026-10-05");
  assert.throws(
    () => assertHistoricalGscRange("2026-09-30", "2026-10-06", PACIFIC, now),
    /gsc_range_includes_current_or_future_day/,
  );
  assert.doesNotThrow(() =>
    assertHistoricalGscRange("2026-09-30", "2026-10-05", PACIFIC, now),
  );
});

test("does not convert GSC dates to Toronto", () => {
  const lateUtc = new Date("2026-10-07T06:30:00Z");
  assert.equal(todayInTimeZone(PACIFIC, lateUtc), "2026-10-06");
  assert.equal(todayInTimeZone("America/Toronto", lateUtc), "2026-10-07");
});

test("weekly chunks are oldest-to-newest", () => {
  assert.deepEqual(weekChunks("2026-09-30", "2026-10-04"), [
    { from: "2026-09-30", to: "2026-10-04" },
  ]);
});
