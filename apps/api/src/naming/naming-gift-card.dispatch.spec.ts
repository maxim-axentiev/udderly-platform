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
import { namingObjects, namingReservations } from "../database/schema/naming";
import {
  NamingGiftCardDispatchService,
  namingGiftCardJobId,
} from "./naming-gift-card.dispatch";
import { NamingGiftCardProcessor } from "./naming-gift-card.processor";
import { createNamingToken, hashNamingToken } from "./naming-gift-card";
import { NamingGiftCardService } from "./naming-gift-card.service";

test("a naming token is unguessable and only its hash is comparable", () => {
  const first = createNamingToken();
  const second = createNamingToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.hash, hashNamingToken(first.token));
  assert.notEqual(first.token, first.hash);
  assert.notEqual(first.token, second.token);
});

test("gift-card jobs retry failed work and ignore a job already waiting", async () => {
  const jobs = new Map<string, { state: string; added: number }>();
  const queue = {
    async getJob(jobId: string) {
      const job = jobs.get(jobId);
      if (!job) {
        return undefined;
      }
      return {
        getState: async () => job.state,
        retry: async () => {
          job.state = "waiting";
        },
        remove: async () => {
          jobs.delete(jobId);
        },
      };
    },
    async add(
      _name: string,
      _data: { eventId: string },
      options: { jobId: string; attempts: number; backoff: { type: string; delay: number } },
    ) {
      assert.equal(options.attempts, 3);
      assert.deepEqual(options.backoff, { type: "exponential", delay: 1000 });
      const current = jobs.get(options.jobId);
      jobs.set(options.jobId, {
        state: "waiting",
        added: (current?.added ?? 0) + 1,
      });
    },
  };
  const dispatch = new NamingGiftCardDispatchService(
    { db: {} } as never,
    queue as never,
  );
  const eventId = "55555555-5555-4555-8555-555555555555";

  assert.equal(await dispatch.enqueueEvent(eventId), "enqueued");
  assert.equal(jobs.get(namingGiftCardJobId(eventId))?.added, 1);
  assert.equal(await dispatch.enqueueEvent(eventId), "skipped");
  assert.equal(jobs.get(namingGiftCardJobId(eventId))?.added, 1);

  const failedJob = jobs.get(namingGiftCardJobId(eventId));
  assert.ok(failedJob);
  failedJob.state = "failed";
  assert.equal(await dispatch.enqueueEvent(eventId), "enqueued");
  assert.equal(failedJob.state, "waiting");
  assert.equal(failedJob.added, 1);
});

test("a queue outage is reported without throwing", async () => {
  const dispatch = new NamingGiftCardDispatchService(
    { db: {} } as never,
    {
      getJob: async () => {
        throw new Error("Redis unavailable");
      },
    } as never,
  );
  assert.equal(
    await dispatch.enqueueEvent("66666666-6666-4666-8666-666666666666"),
    "failed",
  );
});

test("the worker retries database errors and skips unrelated or duplicate rows", async () => {
  const calls: unknown[] = [];
  const gifts = {
    match: async (payload: unknown) => {
      calls.push(payload);
      return { outcome: "ignored", reason: "invalid_payment" };
    },
  };
  const processor = new NamingGiftCardProcessor(
    {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                throw new Error("db down");
              },
            }),
          }),
        }),
      },
    } as never,
    gifts as never,
  );
  await assert.rejects(
    () => processor.process({ data: { eventId: "event-1" } } as never),
    /db down/,
  );
  assert.equal(calls.length, 0);

  const quiet = new NamingGiftCardProcessor(
    {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  provider: "fareharbor",
                  duplicateOf: null,
                  payload: {
                    booking: { availability: { item: { pk: 308264 } } },
                  },
                },
              ],
            }),
          }),
        }),
      },
    } as never,
    gifts as never,
  );
  await quiet.process({ data: { eventId: "event-2" } } as never);
  await quiet.process({ data: {} } as never);

  const duplicate = new NamingGiftCardProcessor(
    {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  provider: "fareharbor",
                  duplicateOf: "event-2",
                  payload: giftCardEventPayload("ref-dup"),
                },
              ],
            }),
          }),
        }),
      },
    } as never,
    gifts as never,
  );
  await duplicate.process({ data: { eventId: "event-3" } } as never);
  assert.equal(calls.length, 0);
});

const databaseUrl = dispatchDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
const now = new Date("2026-11-03T01:14:28.000Z");

test.before(async () => {
  if (!databaseUrl) {
    return;
  }
  await ensureDispatchDatabase();
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
});

test.after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("replay matches stored gift-card events and leaves other bookings alone", {
  skip: !databaseUrl,
}, async () => {
  await database.delete(integrationEvents);
  await database
    .update(namingObjects)
    .set({
      status: "available",
      heldReservationId: null,
      claimedReservationId: null,
    });
  await database.delete(namingReservations);
  await database.delete(namingObjects);

  const [object] = await database
    .insert(namingObjects)
    .values({
      name: "Replay gate",
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
      checkoutRef: "ref-replay",
      priceAmount: 2000,
      currency: "CAD",
      status: "held",
      holdExpiresAt: new Date("2026-11-03T01:44:28.000Z"),
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));

  const gift = await insertEvent(giftCardEventPayload("ref-replay"), null);
  await insertEvent(giftCardEventPayload("ref-replay"), gift.id);
  await insertEvent(
    {
      booking: {
        uuid: "00000000-0000-4000-8000-00000000c010",
        status: "booked",
        availability: { item: { pk: 308264, name: "Goat Recess" } },
      },
    },
    null,
  );
  const malformed = await insertEvent(
    {
      booking: {
        uuid: "00000000-0000-4000-8000-00000000c011",
        status: "booked",
        online_booking_references: "ref-malformed",
        availability: { item: { pk: 308290, name: "Gift Card" } },
      },
    },
    null,
  );
  const unmatched = await insertEvent(giftCardEventPayload("ref-unknown"), null);

  const queued: string[] = [];
  const queue = {
    async getJob() {
      return undefined;
    },
    async add(_name: string, data: { eventId: string }) {
      queued.push(data.eventId);
    },
  };
  const dispatch = new NamingGiftCardDispatchService(
    { db: database } as never,
    queue as never,
  );
  const summary = await dispatch.replayStoredGiftCards();
  assert.equal(summary.found, 3);
  assert.equal(summary.enqueued, 3);
  assert.deepEqual(queued.sort(), [gift.id, malformed.id, unmatched.id].sort());

  const gifts = new NamingGiftCardService({ db: database } as never, () => now);
  const processor = new NamingGiftCardProcessor(
    { db: database } as never,
    gifts,
  );
  for (const eventId of queued) {
    await processor.process({ data: { eventId } } as never);
  }

  const [claimed] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reservation.id));
  const [claimedObject] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, object.id));
  const reservations = await database.select().from(namingReservations);
  assert.equal(reservations.length, 1);
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.namingTokenHash, null);
  assert.equal(claimed.fareharborBookingUuid, "00000000-0000-4000-8000-00000000c001");
  assert.equal(claimedObject.status, "claimed");
  assert.equal(claimedObject.publishedAt, null);
  const [stored] = await database
    .select({ status: integrationEvents.processingStatus })
    .from(integrationEvents)
    .where(eq(integrationEvents.id, gift.id));
  assert.equal(stored.status, "received");

  const again = await gifts.match(giftCardEventPayload("ref-replay"));
  assert.equal(again.outcome, "duplicate");
  assert.equal((await database.select().from(namingReservations)).length, 1);
});

function giftCardEventPayload(checkoutRef: string): Record<string, unknown> {
  return {
    booking: {
      uuid: "00000000-0000-4000-8000-00000000c001",
      pk: 1001,
      status: "booked",
      online_booking_references: checkoutRef,
      availability: { item: { pk: 308290, name: "Gift Card" } },
      receipt_total: 2000,
      amount_paid: 2000,
      payments: [
        {
          pk: 501,
          status: "succeeded",
          type: "card",
          currency: "cad",
          amount_paid: 2000,
          created_at: "2026-11-03T01:14:28-0500",
          refunds: [],
        },
      ],
      contact: { email: "synthetic.booker@example.invalid" },
    },
  };
}

async function insertEvent(
  payload: Record<string, unknown>,
  duplicateOf: string | null,
): Promise<{ id: string }> {
  const [event] = await database
    .insert(integrationEvents)
    .values({
      provider: "fareharbor",
      eventType: "booking",
      externalEntityType: "booking",
      externalEntityId:
        typeof payload.booking === "object" &&
        payload.booking &&
        "uuid" in payload.booking
          ? String(payload.booking.uuid)
          : "unknown",
      payload,
      payloadHash: `hash-${randomUUID()}`,
      processingStatus: duplicateOf ? "duplicate" : "received",
      duplicateOf,
    })
    .returning({ id: integrationEvents.id });
  return event;
}

function dispatchDatabaseUrl(): string | undefined {
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
  parsed.pathname = "/naming_dispatch";
  return parsed.toString();
}

async function ensureDispatchDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const existing = await admin<{ datname: string }[]>`
    select datname from pg_database where datname = 'naming_dispatch'
  `;
  if (existing.length === 0) {
    await admin.unsafe("create database naming_dispatch");
  }
  await admin.end({ timeout: 5 });
}
