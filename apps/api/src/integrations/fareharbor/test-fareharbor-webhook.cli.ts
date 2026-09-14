import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { and, eq } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { integrationEvents } from "../../database/schema/integration-events";
import { FareharborWebhookService } from "./fareharbor-webhook.service";
import { FAREHARBOR_PROVIDER } from "./fareharbor.crypto";
import {
  SYNTHETIC_BOOKING_UUID,
  createChangedSyntheticFareharborBookingPayload,
  createSyntheticFareharborBookingPayload,
} from "./fareharbor.synthetic";

const LOCAL_TEST_SECRET = "local-synthetic-fareharbor-webhook-secret";

type EventRow = {
  id: string;
  payloadHash: string;
  processingStatus: string;
  duplicateOf: string | null;
};

async function main(): Promise<void> {
  loadEnvFiles();

  if (!process.env.FAREHARBOR_WEBHOOK_SECRET?.trim()) {
    process.env.FAREHARBOR_WEBHOOK_SECRET = LOCAL_TEST_SECRET;
  }

  const secret = process.env.FAREHARBOR_WEBHOOK_SECRET.trim();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
    logger: ["error", "warn", "log"],
  });
  app.useBodyParser("json", { limit: "2mb" });
  await app.listen(0, "127.0.0.1");

  const baseUrl = await app.getUrl();
  const database = app.get(DatabaseService);

  try {
    await database.db
      .delete(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          eq(integrationEvents.externalEntityId, SYNTHETIC_BOOKING_UUID),
        ),
      );

    const first = createSyntheticFareharborBookingPayload();
    const firstResponse = await postWebhook(baseUrl, secret, first);
    assertStatus("first webhook accepted", firstResponse.status, 200);

    const firstRows = await waitForRows(database, 1);
    const firstEvent = firstRows[0];
    if (!firstEvent) {
      throw new Error("first event was not stored");
    }
    if (firstEvent.duplicateOf) {
      throw new Error("first event was marked duplicate");
    }

    await waitForStatus(database, firstEvent.id, "completed");
    console.log("- first webhook accepted, stored, hashed, and processed");

    const duplicateResponse = await postWebhook(baseUrl, secret, first);
    assertStatus("identical webhook accepted", duplicateResponse.status, 200);
    const afterDuplicate = await waitForRows(database, 2);
    const duplicateEvent = afterDuplicate.find((row) => row.id !== firstEvent.id);
    if (!duplicateEvent) {
      throw new Error("identical webhook was not stored for audit");
    }
    if (duplicateEvent.payloadHash !== firstEvent.payloadHash) {
      throw new Error("identical webhook hash mismatch");
    }
    if (duplicateEvent.duplicateOf !== firstEvent.id) {
      throw new Error("identical webhook was not linked as duplicate");
    }
    if (duplicateEvent.processingStatus !== "duplicate") {
      throw new Error("identical webhook was processed as a new job");
    }
    console.log(
      "- identical webhook stored for audit and skipped duplicate processing",
    );

    const changed = createChangedSyntheticFareharborBookingPayload();
    const changedResponse = await postWebhook(baseUrl, secret, changed);
    assertStatus("changed webhook accepted", changedResponse.status, 200);
    const afterChanged = await waitForRows(database, 3);
    const changedEvent = afterChanged.find(
      (row) =>
        row.id !== firstEvent.id &&
        row.id !== duplicateEvent.id,
    );
    if (!changedEvent) {
      throw new Error("changed webhook was not stored");
    }
    if (changedEvent.payloadHash === firstEvent.payloadHash) {
      throw new Error("changed webhook was treated as identical");
    }
    if (changedEvent.duplicateOf) {
      throw new Error("changed webhook was marked duplicate");
    }
    await waitForStatus(database, changedEvent.id, "completed");
    console.log(
      "- changed webhook for the same booking UUID stored as a new event and processed",
    );

    const invalidSecret = await postWebhook(
      baseUrl,
      "not-the-webhook-secret",
      first,
    );
    assertStatus("invalid secret rejected", invalidSecret.status, 404);
    console.log("- invalid secret rejected");

    const malformed = await postWebhook(baseUrl, secret, { booking: {} });
    assertStatus("malformed payload rejected", malformed.status, 400);
    console.log("- malformed payload rejected");

    const afterRejects = await waitForRows(database, 3);
    if (afterRejects.length !== 3) {
      throw new Error("rejected requests were persisted");
    }

    const fareharbor = app.get(FareharborWebhookService);
    await database.db
      .update(integrationEvents)
      .set({
        processingStatus: "received",
        processedAt: null,
        processingError: null,
      })
      .where(eq(integrationEvents.id, firstEvent.id));

    const recovery = await fareharbor.recoverEligibleEvents();
    if (recovery.enqueued < 1) {
      throw new Error("recovery did not enqueue the pending event");
    }
    await waitForStatus(database, firstEvent.id, "completed");
    console.log(
      "- pending event re-enqueued from PostgreSQL and processed without a FareHarbor retry",
    );

    console.log("");
    console.log("FareHarbor synthetic webhook tests passed.");
  } finally {
    await app.close();
  }
}

async function postWebhook(
  baseUrl: string,
  secret: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/webhooks/fareharbor/${secret}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assertStatus(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${actual}`);
  }
}

async function waitForRows(
  database: DatabaseService,
  minimum: number,
): Promise<EventRow[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await loadSyntheticRows(database);
    if (rows.length >= minimum) {
      return rows;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${minimum} stored events`);
}

async function waitForStatus(
  database: DatabaseService,
  eventId: string,
  status: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await loadSyntheticRows(database);
    const event = rows.find((row) => row.id === eventId);
    if (event?.processingStatus === status) {
      return;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for event processing status ${status}`);
}

async function loadSyntheticRows(
  database: DatabaseService,
): Promise<EventRow[]> {
  return database.db
    .select({
      id: integrationEvents.id,
      payloadHash: integrationEvents.payloadHash,
      processingStatus: integrationEvents.processingStatus,
      duplicateOf: integrationEvents.duplicateOf,
    })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
        eq(integrationEvents.externalEntityId, SYNTHETIC_BOOKING_UUID),
      ),
    );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
