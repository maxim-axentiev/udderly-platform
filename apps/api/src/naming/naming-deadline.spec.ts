import assert from "node:assert/strict";
import test from "node:test";
import {
  namingSubmissionOpen,
  qualifiesForPurchaseDeadline,
  torontoStartOfNextDay,
} from "./naming-deadline";
import { readPaymentCompletedAt } from "./naming-gift-card";

test("payment completion time accepts the FareHarbor offset and ignores booking creation", () => {
  const paidAt = readPaymentCompletedAt("2026-12-31T23:59:59-0500");
  assert.equal(paidAt?.toISOString(), "2027-01-01T04:59:59.000Z");
  assert.equal(readPaymentCompletedAt("2026-12-31T23:59:59-05:00")?.toISOString(), paidAt?.toISOString());
  assert.equal(readPaymentCompletedAt("not-a-time"), null);
  assert.equal(readPaymentCompletedAt("2026-12-31T23:59:59"), null);
});

test("Toronto deadlines use the next local midnight, including the daylight-saving change", () => {
  assert.equal(
    torontoStartOfNextDay({ year: 2026, month: 12, day: 31 }).toISOString(),
    "2027-01-01T05:00:00.000Z",
  );
  assert.equal(
    torontoStartOfNextDay({ year: 2027, month: 1, day: 14 }).toISOString(),
    "2027-01-15T05:00:00.000Z",
  );
  assert.equal(
    torontoStartOfNextDay({ year: 2026, month: 3, day: 8 }).toISOString(),
    "2026-03-09T04:00:00.000Z",
  );
  assert.equal(
    qualifiesForPurchaseDeadline(new Date("2027-01-01T04:59:59.000Z")),
    true,
  );
  assert.equal(
    qualifiesForPurchaseDeadline(new Date("2027-01-01T05:00:00.000Z")),
    false,
  );
  assert.equal(namingSubmissionOpen(new Date("2027-01-15T04:59:59.000Z")), true);
  assert.equal(namingSubmissionOpen(new Date("2027-01-15T05:00:00.000Z")), false);
});
