import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { FareharborWebhookService } from "./fareharbor-webhook.service";
import { createSyntheticFareharborBookingPayload } from "./fareharbor.synthetic";

test("invalid FareHarbor payload is rejected before persistence", async () => {
  const service = new FareharborWebhookService(
    {
      isFareharborWebhookConfigured: true,
      fareharborWebhookSecret: "test-secret",
    } as never,
    {
      db: {
        insert: () => {
          throw new Error("should not persist invalid payload");
        },
      },
    } as never,
    { add: async () => undefined, getJob: async () => undefined } as never,
  );

  await assert.rejects(
    () => service.ingest({ hello: "world" }),
    BadRequestException,
  );
});

test("database failure does not acknowledge receipt", async () => {
  const service = new FareharborWebhookService(
    {
      isFareharborWebhookConfigured: true,
      fareharborWebhookSecret: "test-secret",
    } as never,
    {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => {
                  throw new Error("ECONNREFUSED");
                },
              }),
            }),
          }),
        }),
      },
    } as never,
    { add: async () => undefined, getJob: async () => undefined } as never,
  );

  await assert.rejects(
    () => service.ingest(createSyntheticFareharborBookingPayload()),
    (error: unknown) =>
      error instanceof Error &&
      error.constructor.name === "ServiceUnavailableException",
  );
});

test("queue failure after persist still acknowledges and leaves the event recoverable", async () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  let inserted = false;
  let markedQueued = false;

  const service = new FareharborWebhookService(
    {
      isFareharborWebhookConfigured: true,
      fareharborWebhookSecret: "test-secret",
    } as never,
    {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => [],
              }),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: async () => {
              inserted = true;
              return [{ id: eventId }];
            },
          }),
        }),
        update: () => ({
          set: () => ({
            where: async () => {
              markedQueued = true;
            },
          }),
        }),
      },
    } as never,
    {
      getJob: async () => undefined,
      add: async () => {
        throw new Error("Redis unavailable");
      },
    } as never,
  );

  const result = await service.ingest(createSyntheticFareharborBookingPayload());
  assert.equal(result.duplicate, false);
  assert.equal(inserted, true);
  assert.equal(markedQueued, false);
});

test("a gift-card webhook is queued for naming without changing inbox failure behaviour", async () => {
  const eventId = "22222222-2222-4222-8222-222222222222";
  const namingJobs: string[] = [];
  const service = new FareharborWebhookService(
    {
      isFareharborWebhookConfigured: true,
      fareharborWebhookSecret: "test-secret",
    } as never,
    fakePersistDatabase(eventId),
    { getJob: async () => undefined, add: async () => undefined } as never,
    {
      enqueueEvent: async (id: string) => {
        namingJobs.push(id);
        return "enqueued" as const;
      },
    } as never,
  );

  const result = await service.ingest(giftCardWebhook());
  assert.equal(result.duplicate, false);
  assert.deepEqual(namingJobs, [eventId]);
});

test("an unrelated booking is not queued for naming", async () => {
  const service = new FareharborWebhookService(
    {
      isFareharborWebhookConfigured: true,
      fareharborWebhookSecret: "test-secret",
    } as never,
    fakePersistDatabase("33333333-3333-4333-8333-333333333333"),
    { getJob: async () => undefined, add: async () => undefined } as never,
    {
      enqueueEvent: async () => {
        throw new Error("unrelated booking was queued");
      },
    } as never,
  );

  const result = await service.ingest(createSyntheticFareharborBookingPayload());
  assert.equal(result.duplicate, false);
});

test("naming queue failure still acknowledges the stored webhook", async () => {
  const service = new FareharborWebhookService(
    {
      isFareharborWebhookConfigured: true,
      fareharborWebhookSecret: "test-secret",
    } as never,
    fakePersistDatabase("44444444-4444-4444-8444-444444444444"),
    { getJob: async () => undefined, add: async () => undefined } as never,
    {
      enqueueEvent: async () => {
        throw new Error("Redis unavailable");
      },
    } as never,
  );

  const result = await service.ingest(giftCardWebhook());
  assert.equal(result.duplicate, false);
});

function fakePersistDatabase(eventId: string) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: eventId }],
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    },
  } as never;
}

function giftCardWebhook(): Record<string, unknown> {
  return {
    booking: {
      uuid: "00000000-0000-4000-8000-00000000b001",
      pk: 1001,
      status: "booked",
      online_booking_references: "ref-queue",
      availability: { item: { pk: 308290, name: "Gift Card" } },
      receipt_total: 2000,
      amount_paid: 2000,
      payments: [
        {
          pk: 1,
          status: "succeeded",
          type: "card",
          currency: "cad",
          amount_paid: 2000,
          refunds: [],
        },
      ],
    },
  };
}
