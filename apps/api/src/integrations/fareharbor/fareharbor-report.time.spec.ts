import assert from "node:assert/strict";
import test from "node:test";
import { parseFarmDateTime } from "./fareharbor-report.time";

test("Availability strings are America/Toronto wall times", () => {
  const start = parseFarmDateTime("2026-09-12 @ 03:00pm");
  assert.ok(start);
  assert.equal(start.toISOString(), "2026-09-12T19:00:00.000Z");
});

test("Last Booked At twelve-hour local times parse in America/Toronto", () => {
  const booked = parseFarmDateTime("2026-09-12 02:00pm");
  assert.ok(booked);
  assert.equal(booked.toISOString(), "2026-09-12T18:00:00.000Z");
});
