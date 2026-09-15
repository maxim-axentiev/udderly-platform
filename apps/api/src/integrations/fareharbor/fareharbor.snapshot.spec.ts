import assert from "node:assert/strict";
import test from "node:test";
import { extractFareharborBookingSnapshot } from "./fareharbor.snapshot";
import { createSyntheticFareharborBookingPayload } from "./fareharbor.synthetic";

test("synthetic FareHarbor payload extracts operational snapshot without payments", () => {
  const snapshot = extractFareharborBookingSnapshot(
    createSyntheticFareharborBookingPayload(),
  );

  assert.equal(snapshot.uuid, "00000000-0000-4000-a000-000000000001");
  assert.equal(snapshot.pk, "900001");
  assert.equal(snapshot.status, "booked");
  assert.equal(snapshot.partySize, 2);
  assert.equal(snapshot.sourceType, "online");
  assert.equal(snapshot.isSuperseded, false);
  assert.equal(snapshot.availability?.pk, "700001");
  assert.equal(snapshot.availability?.item?.pk, "600001");
  assert.equal(snapshot.availability?.item?.name, "SYNTHETIC Goat Walk");
  assert.equal(snapshot.customers.length, 2);
  assert.equal(snapshot.customers[0]?.pk, "500001");
  assert.equal(snapshot.customers[0]?.customerType, "Adult");
  assert.equal(snapshot.contact?.email, "synthetic.booker@example.invalid");
});
