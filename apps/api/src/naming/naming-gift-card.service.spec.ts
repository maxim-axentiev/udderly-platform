import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  applySqlMigrations,
  NAMING_SCHEMA_MIGRATIONS,
} from "../database/apply-sql-migration";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { readFareharborGiftCard } from "./naming-gift-card";
import { NamingGiftCardService } from "./naming-gift-card.service";

const PURCHASER_EMAIL = "synthetic.booker@example.invalid";
const BOOKING_UUID = "00000000-0000-4000-8000-00000000a001";
const OTHER_UUID = "00000000-0000-4000-8000-00000000a002";

test("reads a sanitized CA$20 gift-card payment", () => {
  const reading = readFareharborGiftCard(giftCardPayload("ref-a"));
  assert.deepEqual(reading, {
    kind: "payable",
    checkoutRef: "ref-a",
    bookingUuid: BOOKING_UUID,
    paidAmount: 2000,
    paidAt: new Date("2026-11-03T06:14:28.000Z"),
  });
  assert.equal(JSON.stringify(reading).includes(PURCHASER_EMAIL), false);
});

test("rejects the wrong item, a bad payment, and a refund before lookup", () => {
  assert.equal(
    readFareharborGiftCard(giftCardPayload("ref-a", { itemPk: 308264 })).kind,
    "ignored",
  );
  assert.deepEqual(
    readFareharborGiftCard(giftCardPayload("ref-a", { payments: [] })),
    { kind: "ignored", reason: "invalid_payment" },
  );
  assert.equal(
    readFareharborGiftCard(giftCardPayload("ref-a", { receiptTotal: 1500 })).kind,
    "ignored",
  );
  const refunded = readFareharborGiftCard(
    giftCardPayload("ref-a", { refunds: [{ pk: 1 }] }),
  );
  assert.equal(refunded.kind, "refunded");
  assert.equal(JSON.stringify(refunded).includes(PURCHASER_EMAIL), false);
});

const databaseUrl = matchDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
let service: NamingGiftCardService;
let now = new Date("2026-11-03T01:14:28.000Z");

test.before(async () => {
  if (!databaseUrl) {
    return;
  }
  await ensureMatchDatabase();
  sqlClient = postgres(databaseUrl, { max: 8, onnotice: () => {} });
  await sqlClient.unsafe("drop table if exists naming_notice cascade");
  await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
  await sqlClient.unsafe("drop table if exists naming_reservation cascade");
  await sqlClient.unsafe("drop table if exists naming_object cascade");
  await applySqlMigrations(sqlClient, NAMING_SCHEMA_MIGRATIONS);
  database = drizzle(sqlClient);
  service = new NamingGiftCardService({ db: database } as never, () => now);
});

test.after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("claims the held object for an exact CA$20 payment", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T01:14:28.000Z");
  const holdExpiresAt = new Date("2026-11-03T01:44:28.000Z");
  const seeded = await insertHold({
    name: "North gate",
    checkoutRef: "ref-success",
    priceAmount: 2000,
    holdExpiresAt,
  });

  const result = await service.match(giftCardPayload("ref-success"));
  assert.deepEqual(result, {
    outcome: "claimed",
    reservationId: seeded.reservationId,
    objectId: seeded.objectId,
  });
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "claimed");
  assert.equal(reservation.fareharborBookingUuid, BOOKING_UUID);
  assert.equal(reservation.paidAmount, 2000);
  assert.equal(reservation.priceAmount, 2000);
  assert.equal(reservation.namingTokenHash, null);
  assert.equal(reservation.reviewReason, null);
  assert.equal(reservation.submittedName, null);
  assert.equal(object.status, "claimed");
  assert.equal(object.claimedReservationId, seeded.reservationId);
  assert.equal(object.heldReservationId, null);
  assert.equal(JSON.stringify(reservation).includes(PURCHASER_EMAIL), false);
  assert.equal(JSON.stringify(object).includes(PURCHASER_EMAIL), false);

  const claimedAt = reservation.claimedAt?.toISOString();
  const duplicate = await service.match(giftCardPayload("ref-success"));
  assert.deepEqual(duplicate, {
    outcome: "duplicate",
    reservationId: seeded.reservationId,
  });
  const again = await loadReservation(seeded.reservationId);
  assert.equal(again.namingTokenHash, null);
  assert.equal(again.claimedAt?.toISOString(), claimedAt);
  assert.equal(again.reviewReason, null);
});

test("a wrong amount needs review and does not grant naming rights", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T02:00:00.000Z");
  const holdExpiresAt = new Date("2026-11-03T02:30:00.000Z");
  const seeded = await insertHold({
    name: "Short paid",
    checkoutRef: "ref-amount",
    priceAmount: 2000,
    holdExpiresAt,
  });
  const result = await service.match(
    giftCardPayload("ref-amount", { paidAmount: 1500, receiptTotal: 1500 }),
  );
  assert.deepEqual(result, {
    outcome: "underpaid",
    reservationId: seeded.reservationId,
  });
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "needs_review");
  assert.equal(reservation.reviewReason, "underpaid");
  assert.equal(reservation.paidAmount, 1500);
  assert.equal(reservation.fareharborBookingUuid, BOOKING_UUID);
  assert.equal(reservation.namingTokenHash, null);
  assert.ok(reservation.releasedAt);
  assert.equal(object.status, "available");
  assert.equal(object.heldReservationId, null);
  assert.equal(object.claimedReservationId, null);

  const later = await service.match(giftCardPayload("ref-amount"));
  assert.equal(later.outcome, "underpaid");
  assert.equal((await loadObject(seeded.objectId)).status, "available");
  assert.equal((await loadReservation(seeded.reservationId)).reviewReason, "underpaid");
});

test("an expired wrong-amount hold is released instead of kept open", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T03:00:00.000Z");
  const seeded = await insertHold({
    name: "Expired amount",
    checkoutRef: "ref-expired-amount",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T02:00:00.000Z"),
  });
  const result = await service.match(
    giftCardPayload("ref-expired-amount", {
      paidAmount: 500,
      receiptTotal: 500,
      bookingUuid: OTHER_UUID,
    }),
  );
  assert.equal(result.outcome, "underpaid");
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "needs_review");
  assert.equal(reservation.reviewReason, "underpaid");
  assert.ok(reservation.releasedAt);
  assert.equal(reservation.namingTokenHash, null);
  assert.equal(object.status, "available");
  assert.equal(object.heldReservationId, null);
  assert.equal(object.claimedReservationId, null);
});

test("the wrong item, a missing payment, and a receipt mismatch do not claim", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T04:00:00.000Z");
  const seeded = await insertHold({
    name: "Untouched",
    checkoutRef: "ref-invalid",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T04:30:00.000Z"),
  });
  assert.equal(
    (await service.match(giftCardPayload("ref-invalid", { itemPk: 111 }))).outcome,
    "ignored",
  );
  assert.equal(
    (await service.match(giftCardPayload("ref-invalid", { payments: null }))).outcome,
    "ignored",
  );
  assert.equal(
    (
      await service.match(
        giftCardPayload("ref-invalid", { receiptTotal: 2001 }),
      )
    ).outcome,
    "ignored",
  );
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "held");
  assert.equal(reservation.fareharborBookingUuid, null);
  assert.equal(reservation.paidAmount, null);
  assert.equal(object.status, "held");
  assert.equal(object.claimedReservationId, null);
});

test("a refund flags review and a later refund does not unclaim", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T05:00:00.000Z");
  const seeded = await insertHold({
    name: "Refunded",
    checkoutRef: "ref-refund",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T05:30:00.000Z"),
  });
  const reviewed = await service.match(
    giftCardPayload("ref-refund", { refunds: [{ pk: 9 }] }),
  );
  assert.deepEqual(reviewed, {
    outcome: "needs_review",
    reservationId: seeded.reservationId,
    reason: "payment_reversed",
  });
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "needs_review");
  assert.equal(reservation.paidAmount, 2000);
  assert.equal(reservation.namingTokenHash, null);
  assert.equal(object.status, "held");
  assert.equal(object.claimedReservationId, null);

  await clearNamingTables();
  const claimedSeed = await insertHold({
    name: "Claimed then refunded",
    checkoutRef: "ref-refund-late",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T05:30:00.000Z"),
  });
  assert.equal(
    (await service.match(giftCardPayload("ref-refund-late"))).outcome,
    "claimed",
  );
  const reversed = await service.match(
    giftCardPayload("ref-refund-late", { refunds: [{ pk: 9 }] }),
  );
  assert.deepEqual(reversed, {
    outcome: "payment_reversed",
    reservationId: claimedSeed.reservationId,
  });
  const claimed = await loadReservation(claimedSeed.reservationId);
  const claimedObject = await loadObject(claimedSeed.objectId);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.reviewReason, "payment_reversed");
  assert.equal(claimedObject.status, "claimed");
  assert.equal(claimedObject.claimedReservationId, claimedSeed.reservationId);
});

test("a second booking uuid does not take the claimed object", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T06:00:00.000Z");
  const seeded = await insertHold({
    name: "One claim",
    checkoutRef: "ref-second",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T06:30:00.000Z"),
  });
  assert.equal((await service.match(giftCardPayload("ref-second"))).outcome, "claimed");
  const second = await service.match(
    giftCardPayload("ref-second", { bookingUuid: OTHER_UUID }),
  );
  assert.deepEqual(second, {
    outcome: "needs_review",
    reservationId: seeded.reservationId,
    reason: "duplicate_booking",
  });
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "claimed");
  assert.equal(reservation.fareharborBookingUuid, BOOKING_UUID);
  assert.equal(reservation.reviewReason, "duplicate_booking");
  assert.equal(object.status, "claimed");
  assert.equal(object.claimedReservationId, seeded.reservationId);
});

test("the same booking uuid cannot claim a second object", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T07:00:00.000Z");
  const first = await insertHold({
    name: "First object",
    checkoutRef: "ref-uuid-a",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T07:30:00.000Z"),
  });
  const second = await insertHold({
    name: "Second object",
    checkoutRef: "ref-uuid-b",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T07:30:00.000Z"),
  });
  assert.equal(
    (await service.match(giftCardPayload("ref-uuid-a"))).outcome,
    "claimed",
  );
  const conflict = await service.match(giftCardPayload("ref-uuid-b"));
  assert.deepEqual(conflict, {
    outcome: "needs_review",
    reservationId: second.reservationId,
    reason: "duplicate_booking",
  });
  const firstReservation = await loadReservation(first.reservationId);
  const secondReservation = await loadReservation(second.reservationId);
  const secondObject = await loadObject(second.objectId);
  assert.equal(firstReservation.status, "claimed");
  assert.equal(firstReservation.fareharborBookingUuid, BOOKING_UUID);
  assert.equal(secondReservation.status, "needs_review");
  assert.equal(secondReservation.fareharborBookingUuid, null);
  assert.equal(secondReservation.namingTokenHash, null);
  assert.equal(secondObject.status, "held");
  assert.equal(secondObject.heldReservationId, second.reservationId);
  assert.equal(secondObject.claimedReservationId, null);
});

test("an expired reservation claims an object that is still available", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T08:00:00.000Z");
  const seeded = await insertReleased({
    name: "Expired free",
    checkoutRef: "ref-late-free",
    priceAmount: 2000,
  });
  const result = await service.match(giftCardPayload("ref-late-free"));
  assert.equal(result.outcome, "claimed");
  const reservation = await loadReservation(seeded.reservationId);
  const object = await loadObject(seeded.objectId);
  assert.equal(reservation.status, "claimed");
  assert.equal(reservation.paidAmount, 2000);
  assert.equal(object.status, "claimed");
  assert.equal(object.claimedReservationId, seeded.reservationId);
});

test("an exact payment does not displace an object claimed by someone else", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T09:30:00.000Z");
  const [object] = await database
    .insert(namingObjects)
    .values({
      name: "Already named",
      description: "",
      priceAmount: 2000,
      currency: "CAD",
      publishedAt: now,
      status: "available",
    })
    .returning();
  const [claimed] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: "ref-existing-claim",
      priceAmount: 2000,
      currency: "CAD",
      status: "claimed",
      claimedAt: now,
      fareharborBookingUuid: "00000000-0000-4000-8000-00000000a003",
      paidAmount: 2000,
      adminResolutionRequired: false,
    })
    .returning();
  const [late] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: "ref-after-claim",
      priceAmount: 2000,
      currency: "CAD",
      status: "released",
      releasedAt: new Date("2026-11-03T09:00:00.000Z"),
      holdExpiresAt: new Date("2026-11-03T09:10:00.000Z"),
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "claimed", claimedReservationId: claimed.id })
    .where(eq(namingObjects.id, object.id));

  const result = await service.match(giftCardPayload("ref-after-claim"));
  assert.deepEqual(result, {
    outcome: "needs_review",
    reservationId: late.id,
    reason: "late_conflict",
  });
  const lateReservation = await loadReservation(late.id);
  const objectAfter = await loadObject(object.id);
  assert.equal(lateReservation.namingTokenHash, null);
  assert.equal(lateReservation.status, "needs_review");
  assert.equal(objectAfter.status, "claimed");
  assert.equal(objectAfter.claimedReservationId, claimed.id);
});

test("an expired reservation does not displace a newer holder", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T09:00:00.000Z");
  const expired = await insertReleased({
    name: "Shared post",
    checkoutRef: "ref-late-conflict",
    priceAmount: 2000,
  });
  const [newer] = await database
    .insert(namingReservations)
    .values({
      objectId: expired.objectId,
      checkoutRef: "ref-newer-holder",
      priceAmount: 2000,
      currency: "CAD",
      status: "held",
      holdExpiresAt: new Date("2026-11-03T09:30:00.000Z"),
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: newer.id })
    .where(eq(namingObjects.id, expired.objectId));

  const result = await service.match(giftCardPayload("ref-late-conflict"));
  assert.deepEqual(result, {
    outcome: "needs_review",
    reservationId: expired.reservationId,
    reason: "late_conflict",
  });
  const oldReservation = await loadReservation(expired.reservationId);
  const newerReservation = await loadReservation(newer.id);
  const object = await loadObject(expired.objectId);
  assert.equal(oldReservation.status, "needs_review");
  assert.equal(oldReservation.fareharborBookingUuid, BOOKING_UUID);
  assert.equal(oldReservation.paidAmount, 2000);
  assert.equal(oldReservation.namingTokenHash, null);
  assert.ok(oldReservation.releasedAt);
  assert.equal(newerReservation.status, "held");
  assert.equal(object.status, "held");
  assert.equal(object.heldReservationId, newer.id);
  assert.equal(object.claimedReservationId, null);
});

test("concurrent matches claim once", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T10:00:00.000Z");
  const seeded = await insertHold({
    name: "Race",
    checkoutRef: "ref-race",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T10:30:00.000Z"),
  });
  const [first, second] = await Promise.all([
    service.match(giftCardPayload("ref-race", { bookingUuid: BOOKING_UUID })),
    service.match(giftCardPayload("ref-race", { bookingUuid: OTHER_UUID })),
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ["claimed", "needs_review"]);
  const reservations = await database.select().from(namingReservations);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].status, "claimed");
  assert.equal(reservations[0].reviewReason, "duplicate_booking");
  assert.ok(
    reservations[0].fareharborBookingUuid === BOOKING_UUID ||
      reservations[0].fareharborBookingUuid === OTHER_UUID,
  );
  const object = await loadObject(seeded.objectId);
  assert.equal(object.status, "claimed");
  assert.equal(object.claimedReservationId, seeded.reservationId);

  await clearNamingTables();
  const same = await insertHold({
    name: "Same race",
    checkoutRef: "ref-same-race",
    priceAmount: 2000,
    holdExpiresAt: new Date("2026-11-03T10:30:00.000Z"),
  });
  const repeated = await Promise.all([
    service.match(giftCardPayload("ref-same-race")),
    service.match(giftCardPayload("ref-same-race")),
  ]);
  assert.deepEqual(
    repeated.map((result) => result.outcome).sort(),
    ["claimed", "duplicate"],
  );
  const rows = await database.select().from(namingReservations);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "claimed");
  assert.equal(rows[0].reviewReason, null);
  assert.equal(rows[0].fareharborBookingUuid, BOOKING_UUID);
  const sameObject = await loadObject(same.objectId);
  assert.equal(sameObject.claimedReservationId, same.reservationId);
});

test("an unknown reference is ignored", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  const result = await service.match(giftCardPayload("missing-ref"));
  assert.deepEqual(result, {
    outcome: "ignored",
    reason: "unmatched_reference",
  });
  assert.equal((await database.select().from(namingReservations)).length, 0);
});

function giftCardPayload(
  checkoutRef: string,
  overrides: {
    itemPk?: number;
    bookingUuid?: string;
    paidAmount?: number;
    receiptTotal?: number;
    payments?: unknown;
    refunds?: unknown[];
    createdAt?: string | null;
  } = {},
): Record<string, unknown> {
  const paidAmount = overrides.paidAmount ?? 2000;
  const receiptTotal = overrides.receiptTotal ?? paidAmount;
  const createdAt = overrides.createdAt === undefined
    ? "2026-11-03T01:14:28-0500"
    : overrides.createdAt;
  return {
    booking: {
      uuid: overrides.bookingUuid ?? BOOKING_UUID,
      pk: 1001,
      status: "booked",
      online_booking_references: checkoutRef,
      availability: {
        item: {
          pk: overrides.itemPk ?? 308290,
          name: "Gift Card",
        },
      },
      receipt_total: receiptTotal,
      amount_paid: receiptTotal,
      payments:
        overrides.payments === undefined
          ? [
              {
                pk: 501,
                status: "succeeded",
                type: "card",
                currency: "cad",
                amount_paid: paidAmount,
                amount_paid_display: "20.00",
                ...(createdAt ? { created_at: createdAt } : {}),
                refunds: overrides.refunds ?? [],
              },
            ]
          : overrides.payments,
      contact: {
        email: PURCHASER_EMAIL,
        name: "Synthetic Purchaser",
      },
    },
  };
}

function matchDatabaseUrl(): string | undefined {
  const url = process.env.NAMING_TEST_DATABASE_URL;
  if (!url) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("NAMING_TEST_DATABASE_URL must point at localhost");
  }
  if (parsed.pathname !== "/naming") {
    throw new Error("NAMING_TEST_DATABASE_URL must use the naming database");
  }
  parsed.pathname = "/naming_match";
  return parsed.toString();
}

async function ensureMatchDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const existing = await admin<{ datname: string }[]>`
    select datname from pg_database where datname = 'naming_match'
  `;
  if (existing.length === 0) {
    await admin.unsafe("create database naming_match");
  }
  await admin.end({ timeout: 5 });
}

async function clearNamingTables(): Promise<void> {
  await database
    .update(namingObjects)
    .set({
      status: "available",
      heldReservationId: null,
      claimedReservationId: null,
    });
  await database.delete(namingReservations);
  await database.delete(namingObjects);
}

async function insertHold(input: {
  name: string;
  checkoutRef: string;
  priceAmount: number;
  holdExpiresAt: Date;
}): Promise<{ objectId: string; reservationId: string }> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name: input.name,
      description: "",
      priceAmount: input.priceAmount,
      currency: "CAD",
      publishedAt: now,
      status: "available",
    })
    .returning({ id: namingObjects.id });
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: input.checkoutRef,
      priceAmount: input.priceAmount,
      currency: "CAD",
      status: "held",
      holdExpiresAt: input.holdExpiresAt,
      adminResolutionRequired: false,
    })
    .returning({ id: namingReservations.id });
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));
  return { objectId: object.id, reservationId: reservation.id };
}

async function insertReleased(input: {
  name: string;
  checkoutRef: string;
  priceAmount: number;
}): Promise<{ objectId: string; reservationId: string }> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name: input.name,
      description: "",
      priceAmount: input.priceAmount,
      currency: "CAD",
      publishedAt: now,
      status: "available",
    })
    .returning({ id: namingObjects.id });
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: input.checkoutRef,
      priceAmount: input.priceAmount,
      currency: "CAD",
      status: "released",
      releasedAt: new Date("2026-11-03T00:00:00.000Z"),
      holdExpiresAt: new Date("2026-11-03T00:30:00.000Z"),
      adminResolutionRequired: false,
    })
    .returning({ id: namingReservations.id });
  return { objectId: object.id, reservationId: reservation.id };
}

async function loadReservation(id: string) {
  const [reservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, id));
  return reservation;
}

async function loadObject(id: string) {
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, id));
  return object;
}
