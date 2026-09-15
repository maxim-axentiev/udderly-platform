import assert from "node:assert/strict";
import test from "node:test";
import {
  visitOccurrenceIdentity,
  visitOccurrenceInstant,
} from "./wherewolf.occurrence";

test("guest.id plus reservationsID is the occurrence key", () => {
  const occurrence = visitOccurrenceIdentity("880001", {
    reservationsID: 770001,
    lastVisit: "2026-09-15T18:00:00.000Z",
  });
  assert.equal(occurrence?.key, "880001:r:770001");
  assert.equal(occurrence?.visitedAt?.toISOString(), "2026-09-15T18:00:00.000Z");
});

test("same guest id with two reservations yields two keys", () => {
  const first = visitOccurrenceIdentity("880001", { reservationsID: "770001" });
  const second = visitOccurrenceIdentity("880001", { reservationsID: "770002" });
  assert.equal(first?.key, "880001:r:770001");
  assert.equal(second?.key, "880001:r:770002");
  assert.notEqual(first?.key, second?.key);
});

test("lastVisit without reservation id is a visit-occurrence key", () => {
  const occurrence = visitOccurrenceIdentity("880001", {
    lastVisit: "2026-09-15T18:00:00.000Z",
  });
  assert.equal(occurrence?.key, "880001:t:2026-09-15T18:00:00.000Z");
});

test("guest.id alone is not a visit-occurrence identity", () => {
  assert.equal(visitOccurrenceIdentity("880001", { signed: true }), undefined);
});

test("createdAt and signed are not occurrence timing", () => {
  assert.equal(
    visitOccurrenceInstant({
      createdAt: "2026-09-15T18:00:00.000Z",
      signed: true,
    }),
    undefined,
  );
});

test("reservation startTime supplies timing when the guest has none", () => {
  const instant = visitOccurrenceInstant(
    { reservationsID: "770001" },
    { startTime: "2026-09-15T18:00:00.000Z" },
  );
  assert.equal(instant?.toISOString(), "2026-09-15T18:00:00.000Z");
});
