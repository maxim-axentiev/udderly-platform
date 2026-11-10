import "reflect-metadata";
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { ConflictException } from "@nestjs/common";
import {
  FareharborTierConfigError,
  CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID,
  CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID,
  defaultFareharborTierCheckouts,
  expectedFareharborItemId,
  fareharborAcceptedItemIds,
  fareharborCheckoutUrl,
  isFareharborCheckoutUrl,
  parseFareharborTierCheckouts,
} from "@udderly/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { validateEnv } from "../config/env";
import {
  applySqlMigrations,
  NAMING_SCHEMA_MIGRATIONS,
} from "../database/apply-sql-migration";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { isFareharborGiftCardItem } from "./naming-gift-card";
import { NamingGiftCardService } from "./naming-gift-card.service";
import { NamingPublicController } from "./naming-public.controller";
import { NamingReservationService } from "./naming-reservation.service";

const TEST_TIERS = [
  { priceCents: 10_000, itemId: "900100", flowId: "800100" },
  { priceCents: 25_000, itemId: "900250", flowId: "800250" },
  { priceCents: 50_000, itemId: "900500", flowId: "800500" },
  { priceCents: 100_000, itemId: "901000", flowId: "801000" },
] as const;

const TEST_TIER_CONFIG = TEST_TIERS.map(
  (tier) => `${tier.priceCents}:${tier.itemId}:${tier.flowId}`,
).join(",");

const ENV_BASE = {
  DATABASE_URL: "postgresql://postgres:naming@127.0.0.1:55432/naming",
  REDIS_URL: "redis://127.0.0.1:6379",
};

test("an empty tier setting keeps the confirmed gift-card item on every tier", () => {
  for (const raw of [undefined, "", "   "]) {
    const tiers = parseFareharborTierCheckouts(raw);
    assert.deepEqual(
      tiers.map((tier) => tier.priceCents),
      [10_000, 25_000, 50_000, 100_000],
    );
    assert.ok(
      tiers.every(
        (tier) =>
          tier.itemId === CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID &&
          tier.flowId === CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID,
      ),
    );
  }
  const explicit = parseFareharborTierCheckouts(
    "100000:308290:573099, 10000:308290:573099, 50000:308290:573099, 25000:308290:573099",
  );
  assert.deepEqual(explicit, defaultFareharborTierCheckouts());
});

test("a partial, extra, or malformed tier setting fails closed", () => {
  assert.throws(
    () => parseFareharborTierCheckouts("10000:900100:800100,25000:900250:800250"),
    FareharborTierConfigError,
  );
  assert.throws(
    () => parseFareharborTierCheckouts(`${TEST_TIER_CONFIG},2000:308290:573099`),
    FareharborTierConfigError,
  );
  assert.throws(
    () =>
      parseFareharborTierCheckouts(
        "10000:900100:800100,10000:900250:800250,50000:900500:800500,100000:901000:801000",
      ),
    FareharborTierConfigError,
  );
  assert.throws(
    () => parseFareharborTierCheckouts(TEST_TIER_CONFIG.replace("900100", "0900100")),
    FareharborTierConfigError,
  );
  assert.throws(
    () => parseFareharborTierCheckouts("10000-900100-800100"),
    FareharborTierConfigError,
  );
  assert.throws(
    () => validateEnv({ ...ENV_BASE, NAMING_FAREHARBOR_TIERS: "10000:900100:800100" }),
    /NAMING_FAREHARBOR_TIERS/,
  );
  assert.equal(validateEnv(ENV_BASE).NAMING_FAREHARBOR_TIERS, undefined);
});

test("checkout urls keep the tier item, flow, and reservation reference", () => {
  const refs = ["ref_one-1", "ref_two-2", "ref_three-3", "ref_four-4"];
  const urls = TEST_TIERS.map((tier, index) => fareharborCheckoutUrl(tier, refs[index]));
  assert.deepEqual(urls, [
    "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/900100/?full-items=yes&flow=800100&ref=ref_one-1",
    "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/900250/?full-items=yes&flow=800250&ref=ref_two-2",
    "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/900500/?full-items=yes&flow=800500&ref=ref_three-3",
    "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/901000/?full-items=yes&flow=801000&ref=ref_four-4",
  ]);
  const allowList = TEST_TIERS.map((tier) => ({
    itemId: tier.itemId,
    flowId: tier.flowId,
  }));
  for (const url of urls) {
    assert.equal(isFareharborCheckoutUrl(url, allowList), true);
    assert.equal(isFareharborCheckoutUrl(url), false);
  }
  assert.equal(
    isFareharborCheckoutUrl(urls[0].replace("flow=800100", "flow=800250"), allowList),
    false,
  );
  assert.equal(expectedFareharborItemId(TEST_TIERS, 10_000), "900100");
  assert.equal(expectedFareharborItemId(TEST_TIERS, 2_000), "308290");
  assert.equal(expectedFareharborItemId([], 10_000), undefined);
});

test("the webhook gate accepts only configured items and the confirmed item", () => {
  const allowed = fareharborAcceptedItemIds(TEST_TIERS);
  for (const tier of TEST_TIERS) {
    assert.equal(isFareharborGiftCardItem(payload("ref", tier.itemId, 100), allowed), true);
  }
  assert.equal(isFareharborGiftCardItem(payload("ref", "308290", 100), allowed), true);
  assert.equal(isFareharborGiftCardItem(payload("ref", "111111", 100), allowed), false);
  assert.equal(isFareharborGiftCardItem(payload("ref", "900100", 100)), false);
});

test("a tier without a checkout mapping is refused before a hold", async () => {
  const controller = new NamingPublicController(
    {
      createReservation: async () => ({ outcome: "checkout_unavailable" }),
    } as never,
    { namingCampaignEnabled: true } as never,
    { consume: () => true } as never,
  );
  await assert.rejects(
    () =>
      controller.reserve(
        { objectId: "11111111-1111-4111-8111-111111111111" },
        { ip: "127.0.0.1" } as never,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(error.message, "This object cannot be purchased right now.");
      return true;
    },
  );
});

const databaseUrl = tierDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;
let reservations: NamingReservationService;
let gifts: NamingGiftCardService;
let now = new Date("2026-11-03T01:00:00.000Z");

describe("configured tier checkout", { skip: !databaseUrl }, () => {
before(async () => {
  if (!databaseUrl) {
    throw new Error("naming tier database url is missing");
  }
  await ensureTierDatabase();
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
    TEST_TIERS,
  );
  gifts = new NamingGiftCardService(
    { db: database } as never,
    () => now,
    TEST_TIERS,
  );
});

after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("each tier reservation opens its own checkout item and reference", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const refs: string[] = [];
  for (const tier of TEST_TIERS) {
    const objectId = await insertObject(`Tier ${tier.priceCents}`, tier.priceCents);
    const reserved = await reservations.reserve(objectId);
    assert.equal(reserved.outcome, "reserved");
    if (reserved.outcome !== "reserved") {
      return;
    }
    const [row] = await database
      .select()
      .from(namingReservations)
      .where(eq(namingReservations.id, reserved.reservationId));
    assert.equal(row.priceAmount, tier.priceCents);
    assert.equal(
      reserved.checkoutUrl,
      fareharborCheckoutUrl(tier, row.checkoutRef),
    );
    refs.push(row.checkoutRef);
  }
  assert.equal(new Set(refs).size, TEST_TIERS.length);

  const legacy = new NamingReservationService(
    { db: database } as never,
    { async add() {} } as never,
    () => now,
  );
  const legacyObject = await insertObject("Default tier", 10_000);
  const legacyReserved = await legacy.reserve(legacyObject);
  assert.equal(legacyReserved.outcome, "reserved");
  if (legacyReserved.outcome === "reserved") {
    assert.match(legacyReserved.checkoutUrl, /items\/308290\/\?full-items=yes&flow=573099&ref=/);
  }
});

test("an unmapped price does not create a hold", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  const objectId = await insertObject("Old price", 2_000);
  assert.equal((await reservations.reserve(objectId)).outcome, "checkout_unavailable");
  assert.equal((await database.select().from(namingReservations)).length, 0);
  const [object] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId));
  assert.equal(object.status, "available");
});

test("payments must match the tier item, reference, and minimum amount", {
  skip: !databaseUrl,
}, async () => {
  await clearNamingTables();
  now = new Date("2026-11-03T01:00:00.000Z");
  const holds = [];
  for (const tier of TEST_TIERS) {
    holds.push(
      await insertHold(
        `Paid ${tier.priceCents}`,
        `ref-${tier.itemId}`,
        tier.priceCents,
      ),
    );
  }

  for (const [index, tier] of TEST_TIERS.entries()) {
    const result = await gifts.match(
      payload(`ref-${tier.itemId}`, tier.itemId, tier.priceCents, {
        bookingUuid: `00000000-0000-4000-8000-00000000010${index}`,
      }),
    );
    assert.equal(result.outcome, "claimed");
    const reservation = await loadReservation(holds[index].reservationId);
    assert.equal(reservation.status, "claimed");
    assert.equal(reservation.paidAmount, tier.priceCents);
    assert.equal(reservation.namingTokenHash, null);
  }

  const wrong = await insertHold("Wrong item", "ref-wrong-item", 100_000);
  const wrongItem = await gifts.match(
    payload("ref-wrong-item", "900100", 100_000, {
      bookingUuid: "00000000-0000-4000-8000-000000000201",
    }),
  );
  assert.deepEqual(wrongItem, { outcome: "ignored", reason: "wrong_item" });
  assert.equal((await loadReservation(wrong.reservationId)).status, "held");

  const confirmed = await insertHold("Old item", "ref-old-item", 25_000);
  const oldItem = await gifts.match(
    payload("ref-old-item", "308290", 25_000, {
      bookingUuid: "00000000-0000-4000-8000-000000000202",
    }),
  );
  assert.deepEqual(oldItem, { outcome: "ignored", reason: "wrong_item" });
  assert.equal((await loadReservation(confirmed.reservationId)).status, "held");

  const unknown = await gifts.match(
    payload("missing-ref", "900500", 50_000, {
      bookingUuid: "00000000-0000-4000-8000-000000000203",
    }),
  );
  assert.deepEqual(unknown, { outcome: "ignored", reason: "unmatched_reference" });

  const under = await insertHold("Under", "ref-under", 50_000);
  const underpaid = await gifts.match(
    payload("ref-under", "900500", 49_999, {
      bookingUuid: "00000000-0000-4000-8000-000000000204",
    }),
  );
  assert.equal(underpaid.outcome, "underpaid");
  const underRow = await loadReservation(under.reservationId);
  assert.equal(underRow.status, "needs_review");
  assert.equal(underRow.reviewReason, "underpaid");
  assert.equal(underRow.namingTokenHash, null);
  const [underObject] = await database
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, under.objectId));
  assert.equal(underObject.status, "available");

  const over = await insertHold("Over", "ref-over", 10_000);
  const overpaid = await gifts.match(
    payload("ref-over", "900100", 12_500, {
      bookingUuid: "00000000-0000-4000-8000-000000000205",
    }),
  );
  assert.equal(overpaid.outcome, "claimed");
  const overRow = await loadReservation(over.reservationId);
  assert.equal(overRow.paidAmount, 12_500);
  assert.equal(overRow.status, "claimed");

  const duplicate = await gifts.match(
    payload("ref-over", "900100", 12_500, {
      bookingUuid: "00000000-0000-4000-8000-000000000205",
    }),
  );
  assert.equal(duplicate.outcome, "duplicate");
  assert.equal((await loadReservation(over.reservationId)).status, "claimed");

  const refunded = await gifts.match(
    payload("ref-over", "900100", 12_500, {
      bookingUuid: "00000000-0000-4000-8000-000000000205",
      refunds: [{ pk: 1 }],
    }),
  );
  assert.equal(refunded.outcome, "payment_reversed");

  const wrongRefund = await gifts.match(
    payload("ref-over", "900250", 12_500, {
      bookingUuid: "00000000-0000-4000-8000-000000000205",
      refunds: [{ pk: 2 }],
    }),
  );
  assert.deepEqual(wrongRefund, { outcome: "ignored", reason: "wrong_item" });
  assert.equal((await loadReservation(over.reservationId)).reviewReason, "payment_reversed");

  const unverifiedHold = await insertHold("Unverified", "ref-time", 25_000);
  const unverified = await gifts.match(
    payload("ref-time", "900250", 25_000, {
      bookingUuid: "00000000-0000-4000-8000-000000000206",
      createdAt: null,
    }),
  );
  assert.equal(unverified.outcome, "needs_review");
  if (unverified.outcome === "needs_review") {
    assert.equal(unverified.reason, "payment_time_unverified");
  }
  const unverifiedRow = await loadReservation(unverifiedHold.reservationId);
  assert.equal(unverifiedRow.status, "needs_review");
  assert.equal(unverifiedRow.namingTokenHash, null);
});
});

function payload(
  checkoutRef: string,
  itemId: string,
  paidAmount: number,
  options: {
    bookingUuid?: string;
    createdAt?: string | null;
    refunds?: unknown[];
  } = {},
): Record<string, unknown> {
  const createdAt = options.createdAt === undefined
    ? "2026-11-03T01:14:28-0500"
    : options.createdAt;
  return {
    booking: {
      uuid: options.bookingUuid ?? "00000000-0000-4000-8000-000000000099",
      status: "booked",
      online_booking_references: checkoutRef,
      availability: { item: { pk: Number(itemId), name: "Gift Card" } },
      receipt_total: paidAmount,
      payments: [
        {
          status: "succeeded",
          type: "card",
          currency: "cad",
          amount_paid: paidAmount,
          ...(createdAt ? { created_at: createdAt } : {}),
          refunds: options.refunds ?? [],
        },
      ],
      contact: { email: "synthetic.booker@example.invalid", name: "Synthetic" },
    },
  };
}

function tierDatabaseUrl(): string | undefined {
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
  parsed.pathname = "/naming_tiers";
  return parsed.toString();
}

async function ensureTierDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`set statement_timeout = '8s'`;
    const existing = await admin<{ datname: string }[]>`
      select datname from pg_database where datname = 'naming_tiers'
    `;
    if (existing.length === 0) {
      await admin.unsafe("create database naming_tiers");
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
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

async function insertObject(name: string, priceAmount: number): Promise<string> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name,
      description: "",
      priceAmount,
      currency: "CAD",
      publishedAt: now,
      status: "available",
    })
    .returning({ id: namingObjects.id });
  return object.id;
}

async function insertHold(
  name: string,
  checkoutRef: string,
  priceAmount: number,
): Promise<{ objectId: string; reservationId: string }> {
  const objectId = await insertObject(name, priceAmount);
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId,
      checkoutRef,
      priceAmount,
      currency: "CAD",
      status: "held",
      holdExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      adminResolutionRequired: false,
    })
    .returning({ id: namingReservations.id });
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, objectId));
  return { objectId, reservationId: reservation.id };
}

async function loadReservation(id: string) {
  const [reservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, id));
  return reservation;
}
