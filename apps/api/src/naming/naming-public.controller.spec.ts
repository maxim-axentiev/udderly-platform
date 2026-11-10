import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test, { before, after, describe } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { validateEnv } from "../config/env";
import { EnvService } from "../config/env.service";
import { DatabaseService } from "../database/database.service";
import {
  applySqlMigrations,
  NAMING_SCHEMA_MIGRATIONS,
} from "../database/apply-sql-migration";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { NamingLinkService } from "./naming-link.service";
import { NamingPublicController } from "./naming-public.controller";
import { NamingPublicService } from "./naming-public.service";
import { NamingRateLimiter } from "./naming-rate-limit";
import { NamingReservationService } from "./naming-reservation.service";
import { NAMING_CLOCK } from "./naming.constants";

test("the naming campaign stays off unless the flag is exactly true", () => {
  const base = {
    DATABASE_URL: "postgresql://postgres:naming@127.0.0.1:55432/naming",
    REDIS_URL: "redis://127.0.0.1:6379",
  };
  assert.equal(validateEnv(base).NAMING_CAMPAIGN_ENABLED, false);
  assert.equal(
    validateEnv({ ...base, NAMING_CAMPAIGN_ENABLED: "" }).NAMING_CAMPAIGN_ENABLED,
    false,
  );
  assert.equal(
    validateEnv({ ...base, NAMING_CAMPAIGN_ENABLED: "false" }).NAMING_CAMPAIGN_ENABLED,
    false,
  );
  assert.equal(
    validateEnv({ ...base, NAMING_CAMPAIGN_ENABLED: "true" }).NAMING_CAMPAIGN_ENABLED,
    true,
  );
  assert.throws(() =>
    validateEnv({ ...base, NAMING_CAMPAIGN_ENABLED: "TRUE" }),
  );
});

const databaseUrl = publicDatabaseUrl();
const envStub = { namingCampaignEnabled: true };
let now = new Date("2026-11-03T15:00:00.000Z");
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
let reservations: NamingReservationService;
let links: NamingLinkService;
let app: NestExpressApplication | undefined;
let baseUrl = "";

describe("public naming routes", { concurrency: false, skip: !databaseUrl }, () => {
  before(async () => {
    if (!databaseUrl) {
      return;
    }
    await ensurePublicDatabase();
    sqlClient = postgres(databaseUrl, { max: 8, onnotice: () => {} });
    await sqlClient.unsafe("drop table if exists naming_notice cascade");
    await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
    await sqlClient.unsafe("drop table if exists naming_reservation cascade");
    await sqlClient.unsafe("drop table if exists naming_object cascade");
    await applySqlMigrations(sqlClient, NAMING_SCHEMA_MIGRATIONS);
    database = drizzle(sqlClient);
    reservations = new NamingReservationService(
      { db: database } as never,
      { async add() {} } as never,
      () => now,
    );
    links = new NamingLinkService({ db: database } as never, () => now);
    const application = await NestFactory.create<NestExpressApplication>(
      NamingPublicTestModule,
      { logger: false },
    );
    application.set("trust proxy", 1);
    await application.listen(0, "127.0.0.1");
    const address = application.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    app = application;
  });

  after(async () => {
    await app?.close();
    await sqlClient?.end({ timeout: 5 });
  });

  test("a disabled campaign hides published objects", async () => {
    resetClock();
    envStub.namingCampaignEnabled = false;
    try {
      await clearNamingTables();
      await insertObject({ name: "Visible gate", published: true });
      const response = await fetch(`${baseUrl}/naming/objects`);
      const failureText = await response.clone().text();
      assert.equal(response.status, 404, failureText);
      const body = await response.json();
      assert.equal(JSON.stringify(body).includes("Visible gate"), false);
    } finally {
      envStub.namingCampaignEnabled = true;
    }
  });

  test("the catalog lists only published objects and public fields", async () => {
    resetClock();
    await clearNamingTables();
    const published = await insertObject({
      name: "Pasture gate",
      published: true,
      description: "The gate by the pasture",
      photoUrl: "https://example.invalid/gate.jpg",
      priceAmount: 2500,
    });
    await insertObject({
      name: "Barn door",
      published: true,
      status: "held",
    });
    const secretBooking = randomUUID();
    const secretHash = "ab".repeat(32);
    await insertObject({
      name: "Hidden coop",
      published: false,
      description: "purchaser@example.invalid",
      checkoutRef: "secret-checkout-ref-value",
      bookingUuid: secretBooking,
      tokenHash: secretHash,
    });

    const response = await fetch(`${baseUrl}/naming/objects`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.objects.map((object: { name: string }) => object.name),
      ["Barn door", "Pasture gate"],
    );
    const gate = body.objects.find(
      (object: { name: string }) => object.name === "Pasture gate",
    );
    assert.deepEqual(gate, {
      id: published.id,
      name: "Pasture gate",
      description: "The gate by the pasture",
      photoUrl: "https://example.invalid/gate.jpg",
      priceCents: 2500,
      currency: "CAD",
      availability: "available",
    });
    assert.equal(
      body.objects.find((object: { name: string }) => object.name === "Barn door")
        .availability,
      "held",
    );
    const text = JSON.stringify(body);
    for (const secret of [
      "secret-checkout-ref-value",
      secretBooking,
      secretHash,
      "purchaser@example.invalid",
      "checkoutRef",
      "namingTokenHash",
      "fareharborBookingUuid",
      "heldReservationId",
      "publishedAt",
      "reviewReason",
      "paidAmount",
      "adminResolutionRequired",
    ]) {
      assert.equal(text.includes(secret), false, secret);
    }
  });

  test("unpublished and missing objects return the same not-found response", async () => {
    resetClock();
    await clearNamingTables();
    const hidden = await insertObject({ name: "Closed shed", published: false });
    const hiddenResponse = await postJson(
      "/naming/reservations",
      { objectId: hidden.id },
      "203.0.113.10",
    );
    const missingResponse = await postJson(
      "/naming/reservations",
      { objectId: randomUUID() },
      "203.0.113.10",
    );
    assert.equal(hiddenResponse.status, 404);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(hiddenResponse.body, missingResponse.body);
    assert.equal(JSON.stringify(hiddenResponse.body).includes("Closed shed"), false);
    assert.equal((await loadReservations()).length, 0);
  });

  test("simultaneous reservations leave one hold and one checkout url", async () => {
    resetClock();
    await clearNamingTables();
    const object = await insertObject({ name: "Shared post", published: true });
    const [first, second] = await Promise.all([
      postJson("/naming/reservations", { objectId: object.id }, "203.0.113.21"),
      postJson("/naming/reservations", { objectId: object.id }, "203.0.113.22"),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const created = first.status === 201 ? first.body : second.body;
    assert.deepEqual(Object.keys(created).sort(), [
      "checkoutUrl",
      "holdExpiresAt",
      "reservationId",
    ]);
    assert.match(
      created.checkoutUrl,
      /^https:\/\/fareharbor\.com\/embeds\/book\/udderlyridiculousfarmlife\/items\/308290\/\?full-items=yes&flow=573099&ref=[A-Za-z0-9_-]{22}$/,
    );
    assert.equal("checkoutRef" in created, false);
    const rows = await loadReservations();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "held");
    assert.equal((await loadObject(object.id)).status, "held");
    assert.equal(JSON.stringify(created).includes(rows[0]?.checkoutRef ?? "missing"), true);
  });

  test("reservation status uses the private id and ignores a client payment claim", async () => {
    resetClock();
    await clearNamingTables();
    const object = await insertObject({ name: "Payable gate", published: true });
    const created = await postJson(
      "/naming/reservations",
      { objectId: object.id, paid: true },
      "203.0.113.30",
    );
    assert.equal(created.status, 400);
    const reserved = await postJson(
      "/naming/reservations",
      { objectId: object.id },
      "203.0.113.30",
    );
    assert.equal(reserved.status, 201);
    const reservationId = reserved.body.reservationId as string;
    const checkoutRef = new URL(reserved.body.checkoutUrl as string).searchParams.get(
      "ref",
    );
    assert.ok(checkoutRef);

    const status = await fetch(`${baseUrl}/naming/reservations/${reservationId}`);
    assert.equal(status.status, 200);
    const awaiting = await status.json();
    assert.equal(awaiting.status, "awaiting_payment");
    assert.equal(awaiting.holdExpiresAt, reserved.body.holdExpiresAt);
    assert.equal(awaiting.object.name, "Payable gate");
    const awaitingText = JSON.stringify(awaiting);
    assert.equal(awaitingText.includes(checkoutRef), false);
    assert.equal(awaitingText.includes("checkoutUrl"), false);
    assert.equal(awaitingText.includes("fareharbor"), false);

    for (const path of [
      `/naming/reservations/${reservationId}/claim`,
      `/naming/reservations/${reservationId}/paid`,
    ]) {
      const claim = await postJson(path, { paid: true, status: "claimed" }, "203.0.113.31");
      assert.equal(claim.status, 404);
    }
    assert.equal((await loadReservation(reservationId)).status, "held");

    now = new Date(new Date(reserved.body.holdExpiresAt as string).getTime() + 1000);
    const expired = await fetch(`${baseUrl}/naming/reservations/${reservationId}`);
    assert.equal((await expired.json()).status, "expired");
    assert.equal((await loadObject(object.id)).status, "held");

    const review = await insertReviewReservation();
    const reviewResponse = await fetch(
      `${baseUrl}/naming/reservations/${review.reservationId}`,
    );
    const reviewBody = await reviewResponse.json();
    assert.equal(reviewBody.status, "review");
    const reviewText = JSON.stringify(reviewBody);
    assert.equal(reviewText.includes("amount_mismatch"), false);
    assert.equal(reviewText.includes(review.bookingUuid), false);
    assert.equal(reviewText.includes("paidAmount"), false);
  });

  test("invalid naming links stay hidden and a name can be submitted once", async () => {
    resetClock();
    await clearNamingTables();
    const seeded = await insertClaimed("Creek bridge");
    const issued = await links.issue(seeded.reservationId);
    assert.equal(issued.outcome, "issued");
    if (issued.outcome !== "issued") {
      return;
    }

    const malformed = await fetch(`${baseUrl}/naming/links/not-a-token`);
    assert.equal(malformed.status, 404);
    const unknown = await fetch(`${baseUrl}/naming/links/${"b".repeat(43)}`);
    assert.equal(unknown.status, 404);
    const badSubmit = await postJson(
      `/naming/links/${"b".repeat(43)}`,
      { name: "Nope" },
      "203.0.113.40",
    );
    assert.equal(badSubmit.status, 404);

    const resolved = await fetch(`${baseUrl}/naming/links/${issued.token}`);
    assert.equal(resolved.status, 200);
    assert.deepEqual(await resolved.json(), {
      objectName: "Creek bridge",
      description: "The gate by the pasture",
      photoUrl: "https://example.invalid/gate.jpg",
      namingStatus: "awaiting_name",
      submittedName: null,
      submissionOpen: true,
    });

    const invalidName = await postJson(
      `/naming/links/${issued.token}`,
      { name: "<script>" },
      "203.0.113.40",
    );
    assert.equal(invalidName.status, 400);
    const extra = await postJson(
      `/naming/links/${issued.token}`,
      { name: "Buttercup", paid: true },
      "203.0.113.40",
    );
    assert.equal(extra.status, 400);

    const named = await postJson(
      `/naming/links/${issued.token}`,
      { name: "  Buttercup Bridge  " },
      "203.0.113.40",
    );
    assert.equal(named.status, 200);
    assert.deepEqual(named.body, { submittedName: "Buttercup Bridge" });
    const repeat = await postJson(
      `/naming/links/${issued.token}`,
      { name: "Another Name" },
      "203.0.113.41",
    );
    assert.equal(repeat.status, 409);
    assert.equal(repeat.body.message, "This item already has a name.");
    assert.equal((await loadReservation(seeded.reservationId)).submittedName, "Buttercup Bridge");
    const completed = await fetch(`${baseUrl}/naming/links/${issued.token}`);
    const completedBody = await completed.json();
    assert.equal(completedBody.namingStatus, "named");
    assert.equal(completedBody.submittedName, "Buttercup Bridge");
    assert.equal(JSON.stringify(completedBody).includes(issued.token), false);
    assert.equal((await loadObject(seeded.objectId)).status, "claimed");
  });

  test("a reversed payment cannot accept a new name through the public link", async () => {
    resetClock();
    await clearNamingTables();
    const seeded = await insertClaimed("Refunded gate");
    const issued = await links.issue(seeded.reservationId);
    assert.equal(issued.outcome, "issued");
    if (issued.outcome !== "issued") {
      return;
    }
    await database
      .update(namingReservations)
      .set({ reviewReason: "payment_reversed" })
      .where(eq(namingReservations.id, seeded.reservationId));
    const response = await postJson(
      `/naming/links/${issued.token}`,
      { name: "Late Name" },
      "203.0.113.45",
    );
    assert.equal(response.status, 409);
    assert.equal(response.body.message, "This naming link cannot accept a name.");
    const text = JSON.stringify(response.body);
    assert.equal(text.includes("payment_reversed"), false);
    assert.equal(text.includes(issued.token), false);
    assert.equal((await loadReservation(seeded.reservationId)).submittedName, null);
    const resolved = await fetch(`${baseUrl}/naming/links/${issued.token}`);
    assert.equal((await resolved.json()).namingStatus, "awaiting_name");
  });

  test("reservation creation and name submission are rate limited separately", async () => {
    resetClock();
    await clearNamingTables();
    const object = await insertObject({ name: "Limited gate", published: true });
    const reserveIp = "203.0.113.60";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postJson(
        "/naming/reservations",
        { objectId: randomUUID() },
        reserveIp,
      );
      assert.equal(response.status, 404);
    }
    const limited = await postJson(
      "/naming/reservations",
      { objectId: object.id },
      reserveIp,
    );
    assert.equal(limited.status, 429);
    assert.equal((await loadReservations()).length, 0);
    const otherAddress = await postJson(
      "/naming/reservations",
      { objectId: object.id },
      "203.0.113.61",
    );
    assert.equal(otherAddress.status, 201);

    const seeded = await insertClaimed("Limited name");
    const issued = await links.issue(seeded.reservationId);
    assert.equal(issued.outcome, "issued");
    if (issued.outcome !== "issued") {
      return;
    }
    const submitIp = "203.0.113.70";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await postJson(
        `/naming/links/${"c".repeat(43)}`,
        { name: "Nope" },
        submitIp,
      );
      assert.equal(response.status, 404);
    }
    const blocked = await postJson(
      `/naming/links/${issued.token}`,
      { name: "Blocked Name" },
      submitIp,
    );
    assert.equal(blocked.status, 429);
    assert.equal(JSON.stringify(blocked.body).includes(issued.token), false);
    const allowed = await postJson(
      `/naming/links/${issued.token}`,
      { name: "Allowed Name" },
      "203.0.113.71",
    );
    assert.equal(allowed.status, 200);
    assert.equal(
      (await loadReservation(seeded.reservationId)).submittedName,
      "Allowed Name",
    );
  });
});

@Module({
  controllers: [NamingPublicController],
  providers: [
    NamingPublicService,
    {
      provide: DatabaseService,
      useFactory: () => ({ db: database }) as DatabaseService,
    },
    {
      provide: NamingReservationService,
      useFactory: () => reservations,
    },
    {
      provide: NamingLinkService,
      useFactory: () => links,
    },
    {
      provide: NAMING_CLOCK,
      useValue: () => now,
    },
    {
      provide: EnvService,
      useValue: envStub as EnvService,
    },
    NamingRateLimiter,
  ],
})
class NamingPublicTestModule {}

function resetClock(): void {
  now = new Date("2026-11-03T15:00:00.000Z");
}

async function postJson(
  path: string,
  body: unknown,
  forwardedFor: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
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

async function insertObject(input: {
  name: string;
  published: boolean;
  description?: string;
  photoUrl?: string | null;
  priceAmount?: number;
  status?: "available" | "held";
  checkoutRef?: string;
  bookingUuid?: string;
  tokenHash?: string;
}): Promise<{ id: string }> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name: input.name,
      description: input.description ?? "",
      photoUrl: input.photoUrl ?? null,
      priceAmount: input.priceAmount ?? 10000,
      currency: "CAD",
      publishedAt: input.published ? now : null,
      status: "available",
    })
    .returning();
  if (input.checkoutRef) {
    await database.insert(namingReservations).values({
      objectId: object.id,
      checkoutRef: input.checkoutRef,
      priceAmount: input.priceAmount ?? 10000,
      currency: "CAD",
      status: "claimed",
      claimedAt: now,
      fareharborBookingUuid: input.bookingUuid,
      paidAmount: input.priceAmount ?? 10000,
      namingTokenHash: input.tokenHash,
      adminResolutionRequired: false,
    });
  }
  if (input.status === "held") {
    const [reservation] = await database
      .insert(namingReservations)
      .values({
        objectId: object.id,
        checkoutRef: `held-${object.id}`,
        priceAmount: input.priceAmount ?? 10000,
        currency: "CAD",
        status: "held",
        holdExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        adminResolutionRequired: false,
      })
      .returning();
    await database
      .update(namingObjects)
      .set({ status: "held", heldReservationId: reservation.id })
      .where(eq(namingObjects.id, object.id));
  }
  return { id: object.id };
}

async function insertClaimed(name: string): Promise<{
  objectId: string;
  reservationId: string;
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
      publishedAt: now,
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
  return { objectId: object.id, reservationId: reservation.id };
}

async function insertReviewReservation(): Promise<{
  reservationId: string;
  bookingUuid: string;
}> {
  const bookingUuid = randomUUID();
  const [object] = await database
    .insert(namingObjects)
    .values({
      name: "Review post",
      description: "",
      priceAmount: 2000,
      currency: "CAD",
      publishedAt: now,
      status: "available",
    })
    .returning();
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: `review-${bookingUuid}`,
      priceAmount: 2000,
      currency: "CAD",
      status: "needs_review",
      reviewReason: "amount_mismatch",
      holdExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      fareharborBookingUuid: bookingUuid,
      paidAmount: 1500,
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));
  return { reservationId: reservation.id, bookingUuid };
}

async function loadReservations() {
  return database.select().from(namingReservations);
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

function publicDatabaseUrl(): string | undefined {
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
  parsed.pathname = "/naming_public";
  return parsed.toString();
}

async function ensurePublicDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const existing = await admin<{ datname: string }[]>`
    select datname from pg_database where datname = 'naming_public'
  `;
  if (existing.length === 0) {
    await admin.unsafe("create database naming_public");
  }
  await admin.end({ timeout: 5 });
}
