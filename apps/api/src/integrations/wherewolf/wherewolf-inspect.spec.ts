import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWherewolfInspect,
  type WherewolfInspectSummary,
} from "./wherewolf-inspect.service";

test("inspect report is aggregate-only", () => {
  const summary: WherewolfInspectSummary = {
    farmDate: "2026-09-15",
    timeZone: "America/Toronto",
    dateBegin: "2026-09-15T04:00:00.000Z",
    dateEnd: "2026-09-16T04:00:00.000Z",
    guestSnapshots: 2,
    visitDateUnknown: 1,
    byStatus: { completed: 2 },
    withLastVisit: 2,
    withTripTimeslot: 0,
    signedTrue: 1,
    signedFalse: 0,
    signedAbsent: 1,
    mappedActivity: 1,
    unmappedActivity: 1,
    withReservationId: 1,
    sufficientOccurrenceIdentity: 2,
    insufficientOccurrenceIdentity: 0,
  };
  const report = formatWherewolfInspect(summary);
  assert.match(report, /Guest snapshots: 2/);
  assert.match(report, /signed=true is not attendance/);
  assert.equal(report.includes("SYNTHETIC"), false);
  assert.equal(report.includes("@"), false);
  assert.equal(report.includes("880001"), false);
  assert.equal(report.includes("N0N 0N0"), false);
});
