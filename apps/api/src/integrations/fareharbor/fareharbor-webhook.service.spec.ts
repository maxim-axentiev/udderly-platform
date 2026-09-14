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
