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
import { createCheckoutRef } from "./naming-checkout-ref";
import { NamingHoldProcessor } from "./naming-hold.processor";
import { NamingReservationService } from "./naming-reservation.service";
import {
  fareharborGiftCardCheckoutUrl,
  NAMING_HOLD_MS,
} from "./naming.constants";

test("checkout ref is unguessable and not reused by the generator", () => {
  const first = createCheckoutRef();
  const second = createCheckoutRef();
  assert.match(first, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(first, second);
});

test("checkout url keeps the gift-card item, flow, and full-items flag", () => {
  assert.equal(
    fareharborGiftCardCheckoutUrl("ref_value-1"),
    "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/308290/?full-items=yes&flow=573099&ref=ref_value-1",
  );
});

const databaseUrl = localNamingDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
let service: NamingReservationService;
let now = new Date("2026-11-03T00:00:00.000Z");
const queued: Array<{ delay: number; jobId: string; reservationId: string }> =
  [];

test.before(async () => {
  if (!databaseUrl) {
    return;
  }
  sqlClient = postgres(databaseUrl, {
    max: 8,
    onnotice: () => {},
  });
  await sqlClient.unsafe("drop table if exists naming_notice cascade");
  await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
  await sqlClient.unsafe("drop table if exists naming_reservation cascade");
  await sqlClient.unsafe("drop table if exists naming_object cascade");
  await applySqlMigrations(sqlClient, NAMING_SCHEMA_MIGRATIONS);
  database = drizzle(sqlClient);
  service = new NamingReservationService(
    { db: database } as never,
    {
      async add(
        _name: string,
        data: { reservationId: string },
        options: { delay: number; jobId: string },
      ) {
        queued.push({
          delay: options.delay,
          jobId: options.jobId,
          reservationId: data.reservationId,
        });
      },
    } as never,
    () => now,
  );
});

test.after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("reserves a published object once", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  queued.length = 0;
  now = new Date("2026-11-03T00:00:00.000Z");
  const objectId = await insertObject({
    name: "North gate",
    priceAmount: 10000,
    publishedAt: now,
  });

  const reserved = await service.reserve(objectId);
  assert.equal(reserved.outcome, "reserved");
  if (reserved.outcome !== "reserved") {
    return;
  }
  assert.equal(
    reserved.holdExpiresAt.toISOString(),
    new Date(now.getTime() + NAMING_HOLD_MS).toISOString(),
  );
  const [reservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reserved.reservationId));
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(reservation.priceAmount, 10000);
  assert.equal(reservation.currency, "CAD");
  assert.equal(reservation.status, "held");
  assert.equal(reservation.adminResolutionRequired, false);
  assert.equal(
    reserved.checkoutUrl,
    fareharborGiftCardCheckoutUrl(reservation.checkoutRef),
  );
  assert.match(reserved.checkoutUrl, /[?&]full-items=yes(?:&|$)/);
  assert.match(reserved.checkoutUrl, /[?&]flow=573099(?:&|$)/);
  assert.match(reserved.checkoutUrl, /items\/308290\//);
  assert.equal(object.status, "held");
  assert.equal(object.heldReservationId, reservation.id);
  assert.equal(object.claimedReservationId, null);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].delay, NAMING_HOLD_MS);
  assert.equal(queued[0].jobId, `naming-release-${reservation.id}`);

  await database
    .update(namingObjects)
    .set({ priceAmount: 3000 })
    .where(eq(namingObjects.id, objectId));
  const [afterPriceChange] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reservation.id));
  assert.equal(afterPriceChange.priceAmount, 10000);

  const again = await service.reserve(objectId);
  assert.equal(again.outcome, "unavailable");
  assert.equal(object.heldReservationId, reservation.id);
});

test("rejects an unpublished object", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  const objectId = await insertObject({
    name: "Draft shed",
    priceAmount: 5000,
    publishedAt: null,
  });
  assert.equal((await service.reserve(objectId)).outcome, "unpublished");
  const reservations = await database.select().from(namingReservations);
  assert.equal(reservations.length, 0);
});

test("only one of two simultaneous reservations succeeds", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T02:00:00.000Z");
  const objectId = await insertObject({
    name: "Shared gate",
    priceAmount: 25000,
    publishedAt: now,
  });
  const [first, second] = await Promise.all([
    service.reserve(objectId),
    service.reserve(objectId),
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ["reserved", "unavailable"]);
  const reservations = await database.select().from(namingReservations);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].priceAmount, 25000);
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(object.heldReservationId, reservations[0].id);
  assert.equal(object.status, "held");
});

test("two objects receive different checkout refs", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T03:00:00.000Z");
  const firstId = await insertObject({
    name: "East fence",
    priceAmount: 10000,
    publishedAt: now,
  });
  const secondId = await insertObject({
    name: "West fence",
    priceAmount: 25000,
    publishedAt: now,
  });
  const first = await service.reserve(firstId);
  const second = await service.reserve(secondId);
  assert.equal(first.outcome, "reserved");
  assert.equal(second.outcome, "reserved");
  if (first.outcome !== "reserved" || second.outcome !== "reserved") {
    return;
  }
  const rows = await database.select().from(namingReservations);
  const refs = rows.map((row) => row.checkoutRef);
  assert.equal(new Set(refs).size, 2);
  assert.match(first.checkoutUrl, /ref=/);
  assert.notEqual(first.checkoutUrl, second.checkoutUrl);
});

test("a later reservation releases an expired hold", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T04:00:00.000Z");
  const objectId = await insertObject({
    name: "Timed post",
    priceAmount: 10000,
    publishedAt: now,
  });
  const first = await service.reserve(objectId);
  assert.equal(first.outcome, "reserved");
  if (first.outcome !== "reserved") {
    return;
  }
  now = new Date(now.getTime() + NAMING_HOLD_MS);
  const second = await service.reserve(objectId);
  assert.equal(second.outcome, "reserved");
  const [expired] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, first.reservationId));
  assert.equal(expired.status, "released");
  assert.ok(expired.releasedAt);
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(second.outcome, "reserved");
  if (second.outcome === "reserved") {
    assert.equal(object.heldReservationId, second.reservationId);
  }
  assert.equal(object.status, "held");
  assert.equal(object.claimedReservationId, null);
});

test("release job is idempotent and ignores an older hold", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T05:00:00.000Z");
  const objectId = await insertObject({
    name: "Job post",
    priceAmount: 10000,
    publishedAt: now,
  });
  const first = await service.reserve(objectId);
  assert.equal(first.outcome, "reserved");
  if (first.outcome !== "reserved") {
    return;
  }
  now = new Date(now.getTime() + NAMING_HOLD_MS + 1000);
  const processor = new NamingHoldProcessor(service);
  await processor.process({
    data: { reservationId: first.reservationId },
  } as never);
  await processor.process({
    data: { reservationId: first.reservationId },
  } as never);
  const [releasedObject] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(releasedObject.status, "available");
  assert.equal(releasedObject.heldReservationId, null);

  const renewed = await service.reserve(objectId);
  assert.equal(renewed.outcome, "reserved");
  assert.equal(
    (await service.releaseExpiredHold(first.reservationId)).outcome,
    "unchanged",
  );
  const [current] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(current.status, "held");
  if (renewed.outcome === "reserved") {
    assert.equal(current.heldReservationId, renewed.reservationId);
  }
  const [oldReservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, first.reservationId));
  assert.equal(oldReservation.status, "released");
  assert.equal(current.claimedReservationId, null);

  const claimedObjectId = await insertObject({
    name: "Claimed post",
    priceAmount: 1800,
    publishedAt: now,
  });
  const [claimed] = await database
    .insert(namingReservations)
    .values({
      objectId: claimedObjectId,
      checkoutRef: "claimed-ref",
      priceAmount: 1800,
      currency: "CAD",
      status: "claimed",
      claimedAt: now,
      fareharborBookingUuid: "00000000-0000-4000-8000-000000000012",
      paidAmount: 1800,
      namingTokenHash: "a".repeat(64),
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "claimed", claimedReservationId: claimed.id })
    .where(eq(namingObjects.id, claimedObjectId));
  await processor.process({ data: { reservationId: claimed.id } } as never);
  const [claimedObject] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, claimedObjectId));
  const [claimedReservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, claimed.id));
  assert.equal(claimedObject.status, "claimed");
  assert.equal(claimedObject.claimedReservationId, claimed.id);
  assert.equal(claimedReservation.status, "claimed");
});

test("admin review holds are not released or replaced", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T06:00:00.000Z");
  const objectId = await insertObject({
    name: "Review barn",
    priceAmount: 9000,
    publishedAt: now,
  });
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId,
      checkoutRef: "review-hold-ref",
      priceAmount: 9000,
      currency: "CAD",
      status: "needs_review",
      holdExpiresAt: new Date("2026-11-03T05:00:00.000Z"),
      adminResolutionRequired: true,
      reviewReason: "amount_mismatch",
      paidAmount: 1000,
      fareharborBookingUuid: "00000000-0000-4000-8000-000000000010",
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, objectId));

  now = new Date("2026-11-03T08:00:00.000Z");
  assert.equal(
    (await service.releaseExpiredHold(reservation.id)).outcome,
    "unchanged",
  );
  assert.equal((await service.reserve(objectId)).outcome, "unavailable");
  const [stillReview] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reservation.id));
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(stillReview.status, "needs_review");
  assert.equal(stillReview.releasedAt, null);
  assert.equal(stillReview.adminResolutionRequired, true);
  assert.equal(stillReview.paidAmount, 1000);
  assert.equal(stillReview.namingTokenHash, null);
  assert.equal(object.status, "held");
  assert.equal(object.heldReservationId, reservation.id);
  assert.equal(object.claimedReservationId, null);
});

test("an expired review hold keeps its payment record and does not claim", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T09:00:00.000Z");
  const objectId = await insertObject({
    name: "Timed review",
    priceAmount: 7000,
    publishedAt: now,
  });
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId,
      checkoutRef: "timed-review-ref",
      priceAmount: 7000,
      currency: "CAD",
      status: "needs_review",
      holdExpiresAt: new Date("2026-11-03T08:00:00.000Z"),
      adminResolutionRequired: false,
      reviewReason: "late_conflict",
      paidAmount: 7000,
      fareharborBookingUuid: "00000000-0000-4000-8000-000000000011",
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, objectId));

  assert.equal(
    (await service.releaseExpiredHold(reservation.id)).outcome,
    "released",
  );
  const [reviewed] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reservation.id));
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(reviewed.status, "needs_review");
  assert.ok(reviewed.releasedAt);
  assert.equal(reviewed.paidAmount, 7000);
  assert.equal(reviewed.fareharborBookingUuid, "00000000-0000-4000-8000-000000000011");
  assert.equal(reviewed.namingTokenHash, null);
  assert.equal(object.status, "available");
  assert.equal(object.claimedReservationId, null);
});

function localNamingDatabaseUrl(): string | undefined {
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
  return url;
}

async function clearNamingTables(): Promise<void> {
  await database
    .update(namingObjects)
    .set({ status: "available", heldReservationId: null, claimedReservationId: null });
  await database.delete(namingReservations);
  await database.delete(namingObjects);
}

async function insertObject(input: {
  name: string;
  priceAmount: number;
  publishedAt: Date | null;
}): Promise<string> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name: input.name,
      description: "",
      priceAmount: input.priceAmount,
      currency: "CAD",
      publishedAt: input.publishedAt,
      status: "available",
    })
    .returning({ id: namingObjects.id });
  return object.id;
}
