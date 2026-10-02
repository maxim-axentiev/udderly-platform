import assert from "node:assert/strict";
import test from "node:test";
import { GA_EARLIEST_USEFUL_DATE } from "./google-analytics.constants";
import {
  addCalendarDays,
  assertHistoricalGaRange,
  farmDatesInclusive,
  lastCompletedDate,
  parseGaWindow,
  todayInTimeZone,
  weekChunks,
} from "./google-analytics.range";

const TZ = "America/Toronto";

test("rejects invalid dates, from > to, and pre-property ranges", () => {
  assert.throws(() => parseGaWindow(["--from", "2023-02-30", "--to", "2023-03-01"]));
  assert.throws(() => parseGaWindow(["--from", "2023-03-02", "--to", "2023-03-01"]));
  assert.throws(
    () =>
      assertHistoricalGaRange("2022-04-12", "2022-04-13", TZ, new Date("2026-03-15T15:00:00Z")),
    /ga_range_before_earliest_useful_date/,
  );
});

test("accepts the earliest useful date and yesterday in America/Toronto", () => {
  const now = new Date("2026-03-15T15:00:00Z");
  assert.doesNotThrow(() =>
    assertHistoricalGaRange(GA_EARLIEST_USEFUL_DATE, "2022-04-20", TZ, now),
  );
  const yesterday = lastCompletedDate(TZ, now);
  assert.equal(yesterday, addCalendarDays(todayInTimeZone(TZ, now), -1));
  assert.doesNotThrow(() =>
    assertHistoricalGaRange(yesterday, yesterday, TZ, now),
  );
  assert.throws(
    () => assertHistoricalGaRange(yesterday, todayInTimeZone(TZ, now), TZ, now),
    /ga_range_includes_current_or_future_day/,
  );
});

test("weekly chunks cover every farm date once, including DST transitions", () => {
  const chunks = weekChunks("2023-03-08", "2023-03-21");
  const dates = new Set<string>();
  for (const chunk of chunks) {
    let cursor = chunk.from;
    while (cursor <= chunk.to) {
      assert.equal(dates.has(cursor), false);
      dates.add(cursor);
      cursor = addCalendarDays(cursor, 1);
    }
    assert.ok(chunk.from <= chunk.to);
  }
  assert.equal(dates.has("2023-03-08"), true);
  assert.equal(dates.has("2023-03-12"), true);
  assert.equal(dates.has("2023-03-21"), true);
  assert.equal(dates.size, 14);
  assert.deepEqual(
    chunks.map((chunk) => `${chunk.from}/${chunk.to}`),
    ["2023-03-08/2023-03-14", "2023-03-15/2023-03-21"],
  );
});

test("inclusive farm date enumeration uses civil calendar days", () => {
  assert.deepEqual(farmDatesInclusive("2026-09-18", "2026-09-18"), ["2026-09-18"]);
  assert.equal(farmDatesInclusive("2026-02-27", "2026-03-01").includes("2026-02-28"), true);
});
