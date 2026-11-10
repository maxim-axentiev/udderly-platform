import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  applySqlMigrations,
  NAMING_SCHEMA_MIGRATIONS,
} from "../database/apply-sql-migration";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { hashNamingToken } from "./naming-gift-card";
import { NamingLinkService } from "./naming-link.service";

const databaseUrl = linkDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
let service: NamingLinkService;
const now = new Date("2026-11-03T12:00:00.000Z");

test.before(async () => {
  if (!databaseUrl) {
    return;
  }
  await ensureLinkDatabase();
  sqlClient = postgres(databaseUrl, { max: 8, onnotice: () => {} });
  await sqlClient.unsafe("drop table if exists naming_notice cascade");
  await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
  await sqlClient.unsafe("drop table if exists naming_reservation cascade");
  await sqlClient.unsafe("drop table if exists naming_object cascade");
  await applySqlMigrations(sqlClient, NAMING_SCHEMA_MIGRATIONS);
  database = drizzle(sqlClient);
  service = new NamingLinkService({ db: database } as never, () => now);
});

test.after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("a claimed reservation receives one naming link", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("North gate");
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.path, `/name/${issued.token}`);
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.namingTokenHash, hashNamingToken(issued.token));
  assert.notEqual(reservation.namingTokenHash, issued.token);
  assert.equal(JSON.stringify(reservation).includes(issued.token), false);

  const duplicate = await service.issue(seeded.reservationId);
  assert.deepEqual(duplicate, { outcome: "already_issued" });
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    reservation.namingTokenHash,
  );

  const resolved = await service.resolve(issued.token);
  assert.deepEqual(resolved, {
    outcome: "resolved",
    objectName: "North gate",
    description: "The gate by the pasture",
    photoUrl: "https://example.invalid/gate.jpg",
    namingStatus: "awaiting_name",
    submittedName: null,
    submissionOpen: true,
  });
  assert.equal(JSON.stringify(resolved).includes("checkout"), false);
  assert.equal(JSON.stringify(resolved).includes(seeded.bookingUuid), false);
});

test("a manual link clears a failed email attempt", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Manual gate");
  await database
    .update(namingReservations)
    .set({
      linkDeliveryStatus: "failed",
      linkDeliveryStartedAt: now,
    })
    .where(eq(namingReservations.id, seeded.reservationId));
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.namingTokenHash, hashNamingToken(issued.token));
  assert.equal(reservation.linkDeliveryStatus, null);
  assert.equal(reservation.linkDeliveryStartedAt, null);
  assert.equal(JSON.stringify(reservation).includes(issued.token), false);
});

test("reissue replaces the previous token", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("South gate");
  const first = await service.issue(seeded.reservationId);
  assert.equal(first.outcome, "issued");
  if (first.outcome !== "issued") {
    return;
  }
  const second = await service.issue(seeded.reservationId, { reissue: true });
  assert.equal(second.outcome, "issued");
  if (second.outcome !== "issued") {
    return;
  }
  assert.notEqual(first.token, second.token);
  assert.deepEqual(await service.resolve(first.token), { outcome: "invalid" });
  assert.equal((await service.resolve(second.token)).outcome, "resolved");
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    hashNamingToken(second.token),
  );
});

test("an invalid token and an unpaid reservation cannot name an object", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const held = await insertHeld("Unpaid shed");
  assert.deepEqual(await service.issue(held.reservationId), {
    outcome: "not_claimed",
  });
  assert.equal((await loadReservation(held.reservationId)).namingTokenHash, null);
  assert.deepEqual(await service.resolve("not-a-real-token"), { outcome: "invalid" });
  assert.deepEqual(await service.submit("not-a-real-token", "Buttercup"), {
    outcome: "invalid",
  });
  assert.equal((await database.select().from(namingReservations)).length, 1);
  assert.equal((await loadReservation(held.reservationId)).submittedName, null);
  const object = await loadObject(held.objectId);
  assert.equal(object.status, "held");
});

test("one submission names the object and later submissions do not", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Creek bridge");
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  assert.deepEqual(await service.submit(issued.token, "  <bridge>  "), {
    outcome: "invalid_name",
  });
  const named = await service.submit(issued.token, "  Buttercup Bridge  ");
  assert.deepEqual(named, { outcome: "named", submittedName: "Buttercup Bridge" });
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.submittedName, "Buttercup Bridge");
  assert.ok(reservation.namedAt);
  const object = await loadObject(seeded.objectId);
  assert.equal(object.status, "claimed");
  assert.equal(object.claimedReservationId, seeded.reservationId);

  const repeat = await service.submit(issued.token, "Another Name");
  assert.deepEqual(repeat, { outcome: "already_named" });
  assert.equal(
    (await loadReservation(seeded.reservationId)).submittedName,
    "Buttercup Bridge",
  );
  const resolved = await service.resolve(issued.token);
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome === "resolved") {
    assert.equal(resolved.namingStatus, "named");
    assert.equal(resolved.submittedName, "Buttercup Bridge");
  }
});

test("concurrent submissions store one name", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Race post");
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  const [first, second] = await Promise.all([
    service.submit(issued.token, "First Name"),
    service.submit(issued.token, "Second Name"),
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ["already_named", "named"]);
  const reservation = await loadReservation(seeded.reservationId);
  assert.ok(
    reservation.submittedName === "First Name" ||
      reservation.submittedName === "Second Name",
  );
  assert.equal((await loadObject(seeded.objectId)).status, "claimed");
});

test("a reversed payment cannot accept a new name", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Refunded gate");
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  await database
    .update(namingReservations)
    .set({ reviewReason: "payment_reversed" })
    .where(eq(namingReservations.id, seeded.reservationId));
  assert.deepEqual(await service.submit(issued.token, "Late Name"), {
    outcome: "payment_reversed",
  });
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.submittedName, null);
  assert.equal(reservation.namedAt, null);
  const resolved = await service.resolve(issued.token);
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome === "resolved") {
    assert.equal(resolved.namingStatus, "awaiting_name");
    assert.equal(resolved.submittedName, null);
  }
});

test("a reversed payment keeps a name that was already submitted", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Named then refunded");
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  assert.equal((await service.submit(issued.token, "Kept Name")).outcome, "named");
  await database
    .update(namingReservations)
    .set({ reviewReason: "payment_reversed" })
    .where(eq(namingReservations.id, seeded.reservationId));
  assert.deepEqual(await service.submit(issued.token, "Replacement"), {
    outcome: "already_named",
  });
  assert.equal(
    (await loadReservation(seeded.reservationId)).submittedName,
    "Kept Name",
  );
  const resolved = await service.resolve(issued.token);
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome === "resolved") {
    assert.equal(resolved.submittedName, "Kept Name");
  }
});

test("reissue is rejected after a name is stored", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Finished post");
  const issued = await service.issue(seeded.reservationId);
  assert.equal(issued.outcome, "issued");
  if (issued.outcome !== "issued") {
    return;
  }
  assert.equal((await service.submit(issued.token, "Final Name")).outcome, "named");
  const hash = (await loadReservation(seeded.reservationId)).namingTokenHash;
  assert.deepEqual(await service.issue(seeded.reservationId, { reissue: true }), {
    outcome: "already_named",
  });
  assert.equal((await loadReservation(seeded.reservationId)).namingTokenHash, hash);
  const resolved = await service.resolve(issued.token);
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome === "resolved") {
    assert.equal(resolved.namingStatus, "named");
    assert.equal(resolved.submittedName, "Final Name");
  }
});

test("concurrent issuance keeps the first token", { skip: !databaseUrl }, async () => {
  await clearNamingTables();
  const seeded = await insertClaimed("Single link");
  const [first, second] = await Promise.all([
    service.issue(seeded.reservationId),
    service.issue(seeded.reservationId),
  ]);
  const issued = [first, second].filter((result) => result.outcome === "issued");
  const duplicates = [first, second].filter(
    (result) => result.outcome === "already_issued",
  );
  assert.equal(issued.length, 1);
  assert.equal(duplicates.length, 1);
  if (issued[0]?.outcome !== "issued") {
    return;
  }
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    hashNamingToken(issued[0].token),
  );
});

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

async function insertClaimed(name: string): Promise<{
  objectId: string;
  reservationId: string;
  bookingUuid: string;
}> {
  const bookingUuid = randomUUID();
  const [object] = await database
    .insert(namingObjects)
    .values({
      name,
      description: "The gate by the pasture",
      photoUrl: "https://example.invalid/gate.jpg",
      priceAmount: 2000,
      currency: "CAD",
      publishedAt: null,
      status: "available",
    })
    .returning();
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: `ref-${bookingUuid}`,
      priceAmount: 2000,
      currency: "CAD",
      status: "claimed",
      claimedAt: now,
      fareharborBookingUuid: bookingUuid,
      paidAmount: 2000,
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "claimed", claimedReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));
  return { objectId: object.id, reservationId: reservation.id, bookingUuid };
}

async function insertHeld(name: string): Promise<{
  objectId: string;
  reservationId: string;
}> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name,
      description: "",
      priceAmount: 2000,
      currency: "CAD",
      publishedAt: null,
      status: "available",
    })
    .returning();
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: `held-${object.id}`,
      priceAmount: 2000,
      currency: "CAD",
      status: "held",
      holdExpiresAt: new Date("2026-11-03T12:30:00.000Z"),
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));
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

function linkDatabaseUrl(): string | undefined {
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
  parsed.pathname = "/naming_link";
  return parsed.toString();
}

async function ensureLinkDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const existing = await admin<{ datname: string }[]>`
    select datname from pg_database where datname = 'naming_link'
  `;
  if (existing.length === 0) {
    await admin.unsafe("create database naming_link");
  }
  await admin.end({ timeout: 5 });
}
