import assert from "node:assert/strict";
import test from "node:test";
import {
  FARM_TIME_ZONE,
  farmDayRange,
  farmInclusiveRange,
  instantOnFarmDate,
} from "./wherewolf.range";

test("2026-09-15 is an America/Toronto calendar day, not UTC midnight", () => {
  const range = farmDayRange("2026-09-15");
  assert.equal(FARM_TIME_ZONE, "America/Toronto");
  assert.equal(range.dateBegin, "2026-09-15T04:00:00.000Z");
  assert.equal(range.dateEnd, "2026-09-16T04:00:00.000Z");
  assert.equal(
    instantOnFarmDate(new Date("2026-09-15T03:59:59.000Z"), "2026-09-15"),
    false,
  );
  assert.equal(
    instantOnFarmDate(new Date("2026-09-15T04:00:00.000Z"), "2026-09-15"),
    true,
  );
  assert.equal(
    instantOnFarmDate(new Date("2026-09-16T03:59:59.000Z"), "2026-09-15"),
    true,
  );
  assert.equal(
    instantOnFarmDate(new Date("2026-09-16T04:00:00.000Z"), "2026-09-15"),
    false,
  );
});

test("winter farm days use Eastern Standard Time", () => {
  const range = farmDayRange("2026-01-15");
  assert.equal(range.dateBegin, "2026-01-15T05:00:00.000Z");
  assert.equal(range.dateEnd, "2026-01-16T05:00:00.000Z");
});

test("inclusive --from/--to covers both local dates as half-open UTC", () => {
  const range = farmInclusiveRange("2026-09-15", "2026-09-16");
  assert.equal(range.dateBegin, "2026-09-15T04:00:00.000Z");
  assert.equal(range.dateEnd, "2026-09-17T04:00:00.000Z");
});
