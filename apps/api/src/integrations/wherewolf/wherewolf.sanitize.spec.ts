import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeWherewolfGuest,
  sanitizeWherewolfReservation,
} from "./wherewolf.sanitize";

test("sanitized guest snapshots drop DOB, signature, IP, and contact PII", () => {
  const sanitized = sanitizeWherewolfGuest({
    id: 880001,
    DOB: "2010-01-01",
    name: "SYNTHETIC Guest",
    email: "guest@example.invalid",
    phoneNumber: "+10000000000",
    ipAddress: "203.0.113.10",
    signature: "data:image/png;base64,AAAA",
    signatureGuardian: "data:image/png;base64,BBBB",
    guardianName: "SYNTHETIC Guardian",
    address: "1 Synthetic Street",
    addressPostal: "N0N 0N0",
    city: "Woodstock",
    status: "completed",
    lastVisit: "2026-09-15T14:00:00.000Z",
    signed: "data:image/png;base64,AAAA",
    minor: true,
    reservationsID: 770001,
    activitiesAsObjects: [{ id: 990001, name: "SYNTHETIC WW Glamping" }],
    medical: "asthma",
    passport: "X123",
  });

  assert.ok(sanitized);
  assert.equal(sanitized.id, "880001");
  assert.equal(sanitized.city, "Woodstock");
  assert.equal("addressPostal" in sanitized, false);
  assert.equal(sanitized.status, "completed");
  assert.equal(sanitized.reservationsID, "770001");
  assert.equal(sanitized.signed, undefined);
  assert.equal("DOB" in sanitized, false);
  assert.equal("name" in sanitized, false);
  assert.equal("email" in sanitized, false);
  assert.equal("phoneNumber" in sanitized, false);
  assert.equal("ipAddress" in sanitized, false);
  assert.equal("signature" in sanitized, false);
  assert.equal("signatureGuardian" in sanitized, false);
  assert.equal("guardianName" in sanitized, false);
  assert.equal("address" in sanitized, false);
  assert.equal("medical" in sanitized, false);
  assert.equal("passport" in sanitized, false);
});

test("boolean signed is kept and string signatures are dropped", () => {
  const sanitized = sanitizeWherewolfGuest({
    id: "880002",
    signed: true,
  });
  assert.equal(sanitized?.signed, true);
});

test("H. bookingLabel never survives guest or reservation sanitization", () => {
  const guest = sanitizeWherewolfGuest({
    id: "880001",
    bookingLabel: "SYNTHETIC Customer Name",
  });
  const reservation = sanitizeWherewolfReservation({
    id: "770001",
    bookingLabel: "SYNTHETIC Customer Name",
  });
  assert.equal(guest && "bookingLabel" in guest, false);
  assert.equal(reservation && "bookingLabel" in reservation, false);
});

test("I. free-text name/email aliases are discarded", () => {
  const sanitized = sanitizeWherewolfReservation({
    id: "770001",
    aliases: [
      "SYNTHETIC Customer Name",
      "person@example.invalid",
      "+15555550100",
      "WW-770001",
    ],
  });
  assert.equal(sanitized && "aliases" in sanitized, false);
});

test("J. UUID and decimal-id aliases survive sanitization", () => {
  const sanitized = sanitizeWherewolfReservation({
    id: "770001",
    aliases: [
      "00000000-0000-4000-b000-0000000000aa",
      123456,
      "SYNTHETIC Name",
    ],
  });
  assert.deepEqual(sanitized?.aliases, [
    "00000000-0000-4000-b000-0000000000aa",
    "123456",
  ]);
});
