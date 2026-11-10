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
import { integrationEvents } from "../database/schema/integration-events";
import {
  namingNameRevisions,
  namingNotices,
  namingObjects,
  namingReservations,
} from "../database/schema/naming";
import { hashNamingToken } from "./naming-gift-card";
import { NamingGiftCardProcessor } from "./naming-gift-card.processor";
import { NamingGiftCardService } from "./naming-gift-card.service";
import { NamingLinkService } from "./naming-link.service";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";
import { namingNoticeMessage } from "./naming-notice";
import { NamingNoticeService } from "./naming-notice.service";
import { NamingReservationService } from "./naming-reservation.service";
import { NamingStaffService } from "./naming-staff.service";

const BOOKING = "00000000-0000-4000-8000-00000000d101";
const OTHER = "00000000-0000-4000-8000-00000000d102";
const EMAIL = "purchaser@example.invalid";
const databaseUrl = rulesDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
let now = new Date("2026-12-31T20:00:00.000Z");
let gifts: NamingGiftCardService;
let links: NamingLinkService;
let staff: NamingStaffService;
const mail = {
  fail: false,
  messages: [] as Array<{ to: string; text: string; scope?: string }>,
  async send(message: { to: string; text: string; scope?: string }) {
    if (mail.fail) {
      throw new Error("mailbox rejected the message");
    }
    mail.messages.push(message);
  },
};

test.before(async () => {
  if (!databaseUrl) {
    return;
  }
  await ensureRulesDatabase();
  sqlClient = postgres(databaseUrl, { max: 4, onnotice: () => {} });
  await sqlClient.unsafe("drop table if exists naming_notice cascade");
  await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
  await sqlClient.unsafe("drop table if exists naming_reservation cascade");
  await sqlClient.unsafe("drop table if exists naming_object cascade");
  await sqlClient.unsafe("drop table if exists integration_events cascade");
  await applySqlMigrations(sqlClient, [
    "0001_integration_events.sql",
    ...NAMING_SCHEMA_MIGRATIONS,
  ]);
  database = drizzle(sqlClient);
  gifts = new NamingGiftCardService({ db: database } as never, () => now);
  links = new NamingLinkService({ db: database } as never, () => now);
  const delivery = new NamingLinkDeliveryService(
    { db: database } as never,
    mail as never,
    {
      namingMailConfigured: true,
      namingPublicBaseUrl: "https://names.example",
      namingSmtp: {
        user: "farm@example.com",
        appPassword: "test-app-password",
        from: "farm@example.com",
      },
    } as never,
    () => now,
  );
  staff = new NamingStaffService(
    { db: database } as never,
    delivery,
    () => now,
  );
});

test.after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("an underpaid match queues a notice and not a naming link", async () => {
  const notices: string[] = [];
  const linksQueued: string[] = [];
  const processor = new NamingGiftCardProcessor(
    { db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ provider: "fareharbor", duplicateOf: null, payload: { booking: { availability: { item: { pk: 308290 } } } } }] }) }) }) } } as never,
    { match: async () => ({ outcome: "underpaid", reservationId: "11111111-1111-4111-8111-111111111111" }) } as never,
    { enqueue: async (id: string) => { linksQueued.push(id); return "enqueued"; } } as never,
    { enqueue: async (id: string) => { notices.push(id); return "enqueued"; } } as never,
  );
  await processor.process({ data: { eventId: "event-1" } } as never);
  assert.deepEqual(notices, ["11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(linksQueued, []);
});

test("exact and larger payments claim, and an underpayment releases without taking another hold", {
  skip: !databaseUrl,
}, async () => {
  await reset();
  now = new Date("2026-12-31T20:00:00.000Z");
  const exact = await hold("Exact gate", "ref-exact", 25000);
  assert.equal(
    (await gifts.match(payload("ref-exact", 25000, BOOKING, "2026-12-31T23:59:59-0500"))).outcome,
    "claimed",
  );
  assert.equal((await object(exact.objectId)).status, "claimed");

  const over = await hold("Over gate", "ref-over", 25000);
  const overResult = await gifts.match(payload("ref-over", 30000, OTHER, "2026-12-31T23:00:00-0500"));
  assert.equal(overResult.outcome, "claimed");
  assert.equal((await reservation(over.reservationId)).paidAmount, 30000);

  const low = await hold("Low gate", "ref-low", 25000);
  assert.equal(
    (await gifts.match(payload("ref-low", 10000, randomUUID(), "2026-12-31T22:00:00-0500"))).outcome,
    "underpaid",
  );
  assert.equal((await object(low.objectId)).status, "available");
  assert.equal((await reservation(low.reservationId)).namingTokenHash, null);
  const replay = await gifts.match(payload("ref-low", 25000, randomUUID(), "2026-12-31T22:00:00-0500"));
  assert.equal(replay.outcome, "underpaid");

  const current = await hold("Current hold", "ref-current", 10000);
  const [previous] = await database.insert(namingReservations).values({
    objectId: current.objectId,
    checkoutRef: "ref-previous",
    priceAmount: 10000,
    currency: "CAD",
    status: "released",
    releasedAt: now,
    adminResolutionRequired: false,
  }).returning();
  const competing = await gifts.match(payload("ref-previous", 5000, randomUUID(), "2026-12-31T21:00:00-0500"));
  assert.equal(competing.outcome, "underpaid");
  assert.equal((await object(current.objectId)).heldReservationId, current.reservationId);
  assert.equal((await reservation(previous.id)).namingTokenHash, null);
});

test("a late webhook uses payment created_at, and a missing timestamp does not claim", {
  skip: !databaseUrl,
}, async () => {
  await reset();
  now = new Date("2027-01-01T05:30:00.000Z");
  const onTime = await hold("On time", "ref-on-time", 10000);
  assert.equal(
    (await gifts.match(payload("ref-on-time", 10000, randomUUID(), "2026-12-31T23:59:59-0500"))).outcome,
    "claimed",
  );
  assert.equal((await object(onTime.objectId)).status, "claimed");

  const late = await hold("Late", "ref-late", 10000);
  assert.equal(
    (await gifts.match(payload("ref-late", 10000, randomUUID(), "2027-01-01T00:00:00-0500"))).outcome,
    "purchase_after_deadline",
  );
  assert.equal((await object(late.objectId)).status, "available");

  const missing = await hold("Missing time", "ref-missing", 10000);
  const unverified = await gifts.match(payload("ref-missing", 10000, randomUUID(), null));
  assert.equal(unverified.outcome, "needs_review");
  if (unverified.outcome === "needs_review") {
    assert.equal(unverified.reason, "payment_time_unverified");
  }
  assert.equal((await object(missing.objectId)).status, "held");
});

test("new reservations stop at the purchase deadline", {
  skip: !databaseUrl,
}, async () => {
  await reset();
  const reservations = new NamingReservationService(
    { db: database } as never,
    { add: async () => undefined } as never,
    () => new Date("2027-01-01T05:00:00.000Z"),
  );
  const seeded = await hold("Closed", "ref-closed", 10000);
  await database.update(namingObjects).set({
    status: "available",
    heldReservationId: null,
    publishedAt: now,
  }).where(eq(namingObjects.id, seeded.objectId));
  await database.update(namingReservations).set({
    status: "released",
    releasedAt: now,
  }).where(eq(namingReservations.id, seeded.reservationId));
  assert.equal((await reservations.reserve(seeded.objectId)).outcome, "purchase_closed");
});

test("an underpayment email is sent once and a deadline email stays separate", {
  skip: !databaseUrl,
}, async () => {
  await reset();
  const seeded = await hold("Bucket", "ref-notice", 25000);
  const booking = randomUUID();
  await gifts.match(payload("ref-notice", 10000, booking, "2026-12-31T18:00:00-0500"));
  await insertEvent(booking, payload("ref-notice", 10000, booking, "2026-12-31T18:00:00-0500"));
  const notices = noticeService();
  assert.equal((await notices.deliver(seeded.reservationId, "underpaid")).outcome, "sent");
  assert.equal((await notices.deliver(seeded.reservationId, "underpaid")).outcome, "already_sent");
  assert.equal(mail.messages.length, 1);
  assert.match(mail.messages[0]?.text ?? "", /Bucket/);
  assert.match(mail.messages[0]?.text ?? "", /\$250\.00/);
  assert.match(mail.messages[0]?.text ?? "", /valid/);
  assert.equal((mail.messages[0]?.text ?? "").includes(booking), false);
  assert.equal((await database.select().from(namingNotices)).length, 1);
  const copy = namingNoticeMessage("purchase_after_deadline", "Bucket", 25000);
  assert.match(copy.text, /December 31, 2026/);
  assert.equal(copy.text.includes(booking), false);
});

test("names keep the 40-character limit, old certificates stay open, and staff can correct and resend", {
  skip: !databaseUrl,
}, async () => {
  await reset();
  now = new Date("2026-12-01T15:00:00.000Z");
  const seeded = await claimed("Test Naming Bucket", "Existing Certificate Name That Is Already Stored");
  const before = await reservation(seeded.reservationId);
  assert.equal((await links.resolve(seeded.token)).outcome, "resolved");
  now = new Date("2027-01-15T05:00:00.000Z");
  const resolved = await links.resolve(seeded.token);
  assert.equal(resolved.outcome, "resolved");
  if (resolved.outcome === "resolved") {
    assert.equal(resolved.submissionOpen, false);
    assert.equal(resolved.submittedName, before.submittedName);
  }
  assert.equal((await links.submit(seeded.token, "Another name")).outcome, "already_named");

  const open = await claimed("Open object", null);
  now = new Date("2027-01-14T23:00:00.000Z");
  assert.equal((await links.submit(open.token, "a".repeat(40))).outcome, "named");
  const tooLong = await claimed("Long object", null);
  assert.equal((await links.submit(tooLong.token, "a".repeat(41))).outcome, "invalid_name");

  now = new Date("2027-02-01T15:00:00.000Z");
  const named = await claimed("Staff object", "Misspelled");
  await insertEvent(named.booking, payload("ref-staff", named.price, named.booking, "2026-12-01T12:00:00-0500"));
  const view = await staff.view(named.objectId);
  assert.equal(view?.submittedName, "Misspelled");
  assert.equal(JSON.stringify(view).includes(EMAIL), false);
  assert.equal(JSON.stringify(view).includes(named.token), false);
  const corrected = await staff.correct(named.objectId, "Corrected Name");
  assert.equal(corrected.outcome, "corrected");
  const revision = await database.select().from(namingNameRevisions);
  assert.equal(revision.length, 1);
  assert.equal(revision[0]?.previousName, "Misspelled");
  const preserved = await reservation(named.reservationId);
  assert.equal(preserved.fareharborBookingUuid, before.fareharborBookingUuid ? named.booking : named.booking);
  assert.equal(preserved.paidAmount, named.price);
  assert.equal(preserved.status, "claimed");
  assert.equal(preserved.namingTokenHash, hashNamingToken(named.token));

  mail.fail = true;
  assert.equal((await staff.resend(named.objectId)).outcome, "smtp_failed");
  assert.equal((await reservation(named.reservationId)).namingTokenHash, hashNamingToken(named.token));
  assert.equal((await links.resolve(named.token)).outcome, "resolved");
  mail.fail = false;
  mail.messages.length = 0;
  assert.equal((await staff.resend(named.objectId)).outcome, "sent");
  assert.equal((await links.resolve(named.token)).outcome, "invalid");
  const sent = mail.messages[0]?.text ?? "";
  const replaced = sent.match(/\/name\/([A-Za-z0-9_-]{43})/);
  assert.ok(replaced?.[1]);
  const opened = await links.resolve(replaced[1]);
  assert.equal(opened.outcome, "resolved");
  if (opened.outcome === "resolved") {
    assert.equal(opened.submittedName, "Corrected Name");
  }
  assert.equal((await links.submit(replaced[1], "Second name")).outcome, "already_named");
  assert.equal((await reservation(named.reservationId)).submittedName, "Corrected Name");
  assert.equal(JSON.stringify(mail.messages).includes(EMAIL) ? mail.messages[0]?.to : "", EMAIL);
});

function noticeService(): NamingNoticeService {
  return new NamingNoticeService(
    { db: database } as never,
    mail as never,
    { namingMailConfigured: true, namingSmtp: { user: "a", appPassword: "b", from: "c" } } as never,
    () => now,
  );
}

async function reset(): Promise<void> {
  mail.fail = false;
  mail.messages.length = 0;
  await database.delete(namingNotices);
  await database.delete(namingNameRevisions);
  await database.delete(integrationEvents);
  await database.update(namingObjects).set({
    status: "available",
    heldReservationId: null,
    claimedReservationId: null,
  });
  await database.delete(namingReservations);
  await database.delete(namingObjects);
}

async function hold(name: string, checkoutRef: string, price: number) {
  const [object] = await database.insert(namingObjects).values({
    name,
    description: "",
    priceAmount: price,
    currency: "CAD",
    publishedAt: now,
    status: "available",
  }).returning();
  const [reservation] = await database.insert(namingReservations).values({
    objectId: object.id,
    checkoutRef,
    priceAmount: price,
    currency: "CAD",
    status: "held",
    holdExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    adminResolutionRequired: false,
  }).returning();
  await database.update(namingObjects).set({
    status: "held",
    heldReservationId: reservation.id,
  }).where(eq(namingObjects.id, object.id));
  return { objectId: object.id, reservationId: reservation.id };
}

async function claimed(name: string, submittedName: string | null) {
  const price = 2000;
  const booking = randomUUID();
  const token = `token-${randomUUID().replace(/-/g, "").slice(0, 24)}A`;
  const [object] = await database.insert(namingObjects).values({
    name,
    description: "Preserved",
    priceAmount: price,
    currency: "CAD",
    publishedAt: now,
    status: "available",
  }).returning();
  const [reservation] = await database.insert(namingReservations).values({
    objectId: object.id,
    checkoutRef: `ref-${randomUUID()}`,
    priceAmount: price,
    currency: "CAD",
    status: "claimed",
    claimedAt: new Date("2026-11-03T15:00:00.000Z"),
    fareharborBookingUuid: booking,
    paidAmount: price,
    adminResolutionRequired: false,
    namingTokenHash: hashNamingToken(token),
    submittedName,
    namedAt: submittedName ? new Date("2026-11-03T16:00:00.000Z") : null,
    linkDeliveryStatus: "sent",
    linkDeliveryStartedAt: new Date("2026-11-03T15:30:00.000Z"),
  }).returning();
  await database.update(namingObjects).set({
    status: "claimed",
    claimedReservationId: reservation.id,
  }).where(eq(namingObjects.id, object.id));
  return { objectId: object.id, reservationId: reservation.id, token, booking, price };
}

function payload(
  checkoutRef: string,
  paid: number,
  booking: string,
  createdAt: string | null,
): Record<string, unknown> {
  return {
    booking: {
      uuid: booking,
      pk: 1001,
      status: "booked",
      online_booking_references: checkoutRef,
      availability: { item: { pk: 308290, name: "Gift Card" } },
      receipt_total: paid,
      amount_paid: paid,
      payments: [
        {
          pk: 501,
          status: "succeeded",
          type: "card",
          currency: "cad",
          amount_paid: paid,
          ...(createdAt ? { created_at: createdAt } : {}),
          refunds: [],
        },
      ],
      contact: { email: EMAIL, name: "Synthetic Purchaser" },
    },
  };
}

async function insertEvent(booking: string, body: Record<string, unknown>) {
  await database.insert(integrationEvents).values({
    provider: "fareharbor",
    eventType: "booking",
    externalEntityType: "booking",
    externalEntityId: booking,
    payload: body,
    payloadHash: randomUUID(),
    processingStatus: "completed",
  });
}

function object(id: string) {
  return database.select().from(namingObjects).where(eq(namingObjects.id, id)).limit(1).then((rows) => rows[0]);
}

function reservation(id: string) {
  return database.select().from(namingReservations).where(eq(namingReservations.id, id)).limit(1).then((rows) => rows[0]);
}

function rulesDatabaseUrl(): string | undefined {
  const url = process.env.NAMING_TEST_DATABASE_URL;
  if (!url) return undefined;
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("NAMING_TEST_DATABASE_URL must point at localhost");
  }
  if (parsed.pathname !== "/naming") {
    throw new Error("NAMING_TEST_DATABASE_URL must use the naming database");
  }
  parsed.pathname = "/naming_rules";
  return parsed.toString();
}

async function ensureRulesDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) return;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const existing = await admin<{ datname: string }[]>`
    select datname from pg_database where datname = 'naming_rules'
  `;
  if (existing.length === 0) {
    await admin.unsafe("create database naming_rules");
  }
  await admin.end({ timeout: 5 });
}
