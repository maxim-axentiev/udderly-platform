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
    { add: async () => undefined } as never,
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
    { add: async () => undefined } as never,
  );

  await assert.rejects(
    () => service.ingest(createSyntheticFareharborBookingPayload()),
    (error: unknown) =>
      error instanceof Error &&
      error.constructor.name === "ServiceUnavailableException",
  );
});
