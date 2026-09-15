import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { and, eq, inArray } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import {
  bookingContacts,
  bookingPartyMembers,
  bookings,
} from "../../database/schema/bookings";
import {
  experienceSourceMappings,
  experiences,
  sessions,
} from "../../database/schema/experiences";
import { integrationEvents } from "../../database/schema/integration-events";
import { sourceIdentities } from "../../database/schema/source-identity";
import { FareharborNormalizeService } from "./fareharbor-normalize.service";
import { FareharborExperienceMapService } from "./fareharbor-experience-map.service";
import { FareharborWebhookService } from "./fareharbor-webhook.service";
import {
  FAREHARBOR_BOOKING_ENTITY,
  FAREHARBOR_PROVIDER,
} from "./fareharbor.crypto";
import {
  FAREHARBOR_AVAILABILITY_ENTITY,
  FAREHARBOR_BOOKING_PK_ENTITY,
  FAREHARBOR_CUSTOMER_ENTITY,
  FAREHARBOR_ITEM_OBJECT_TYPE,
} from "./fareharbor.constants";
import {
  SYNTHETIC_BOOKING_UUID,
  createChangedSyntheticFareharborBookingPayload,
  createSyntheticFareharborBookingPayload,
} from "./fareharbor.synthetic";

const LOCAL_TEST_SECRET = "local-synthetic-fareharbor-webhook-secret";
const SYNTHETIC_ITEM_PK = "600001";

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
  const normalize = app.get(FareharborNormalizeService);
  const mapper = app.get(FareharborExperienceMapService);

  try {
    await deleteSyntheticOperationalRows(database);
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
    await assertNoOperationalBooking(database);
    console.log(
      "- first webhook accepted, stored, hashed, and completed without operational rows",
    );

    const unmapped = await normalize.normalizeEvent(firstEvent.id);
    if (unmapped.outcome !== "mapping_required") {
      throw new Error("expected mapping required before curated experience exists");
    }
    if (unmapped.itemPk !== SYNTHETIC_ITEM_PK) {
      throw new Error("mapping required result should include FareHarbor item PK");
    }
    if (unmapped.itemName !== "SYNTHETIC Goat Walk") {
      throw new Error("mapping required result should include FareHarbor item name");
    }
    await assertNoOperationalBooking(database);
    await waitForStatus(database, firstEvent.id, "completed");
    console.log(
      "- completed inbox event can be normalized; unknown mapping writes nothing",
    );

    const seeded = await mapper.mapItem({
      itemId: SYNTHETIC_ITEM_PK,
      name: "SYNTHETIC mapped Goat Walk",
    });
    if (seeded.outcome !== "created") {
      throw new Error("failed to map synthetic FareHarbor item");
    }

    const firstApply = await normalize.normalizeEvent(firstEvent.id);
    if (firstApply.outcome !== "applied") {
      throw new Error("expected first manual normalize to apply");
    }
    const afterFirst = await assertNormalizedBooking(database, {
      status: "booked",
      superseded: false,
      partySize: 2,
      activeMembers: 2,
      inactiveMembers: 0,
    });
    console.log("- manual normalize by event id created operational rows");

    const secondApply = await normalize.normalizeEvent(firstEvent.id);
    if (secondApply.outcome !== "applied") {
      throw new Error("expected idempotent normalize to apply");
    }
    const afterSecond = await assertNormalizedBooking(database, {
      status: "booked",
      superseded: false,
      partySize: 2,
      activeMembers: 2,
      inactiveMembers: 0,
    });
    if (afterFirst.bookingId !== afterSecond.bookingId) {
      throw new Error("idempotent normalize created a different booking");
    }
    if (afterFirst.memberIds.join(",") !== afterSecond.memberIds.join(",")) {
      throw new Error("idempotent normalize replaced party members");
    }
    console.log("- manual normalize of the same event is idempotent");

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
    await assertNormalizedBooking(database, {
      status: "booked",
      superseded: false,
      partySize: 2,
      activeMembers: 2,
      inactiveMembers: 0,
    });
    console.log(
      "- changed webhook completed inbox processing without changing operational rows",
    );

    const latestApply = await normalize.normalizeLatest();
    if (latestApply.outcome !== "applied") {
      throw new Error("expected --latest normalize to apply");
    }
    if (latestApply.eventId !== changedEvent.id) {
      throw new Error("latest original event was not selected");
    }
    await assertNormalizedBooking(database, {
      status: "cancelled",
      superseded: true,
      partySize: 1,
      activeMembers: 1,
      inactiveMembers: 1,
    });
    console.log(
      "- manual normalize of the newer event updated the same booking and inactivated the removed participant",
    );

    const stale = await normalize.normalizeEvent(firstEvent.id);
    if (stale.outcome !== "skipped_stale") {
      throw new Error("expected older event to be skipped");
    }
    await assertNormalizedBooking(database, {
      status: "cancelled",
      superseded: true,
      partySize: 1,
      activeMembers: 1,
      inactiveMembers: 1,
    });
    console.log(
      "- manually normalizing an older event does not roll operational state backward",
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
    await assertNormalizedBooking(database, {
      status: "cancelled",
      superseded: true,
      partySize: 1,
      activeMembers: 1,
      inactiveMembers: 1,
    });
    console.log(
      "- pending event re-enqueued from PostgreSQL and processed without a FareHarbor retry",
    );

    await deleteSyntheticOperationalRows(database);

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

async function assertNoOperationalBooking(
  database: DatabaseService,
): Promise<void> {
  const bookingId = await resolvedInternalId(
    database,
    FAREHARBOR_BOOKING_ENTITY,
    SYNTHETIC_BOOKING_UUID,
  );
  if (bookingId) {
    throw new Error("operational booking was created from inbox processing");
  }
}

async function assertNormalizedBooking(
  database: DatabaseService,
  expected: {
    status: string;
    superseded: boolean;
    partySize: number;
    activeMembers: number;
    inactiveMembers: number;
  },
): Promise<{ bookingId: string; memberIds: string[] }> {
  const bookingId = await resolvedInternalId(
    database,
    FAREHARBOR_BOOKING_ENTITY,
    SYNTHETIC_BOOKING_UUID,
  );
  if (!bookingId) {
    throw new Error("normalized booking was not created");
  }

  const [booking] = await database.db
    .select({
      status: bookings.status,
      partySize: bookings.partySize,
      isSuperseded: bookings.isSuperseded,
      sessionId: bookings.sessionId,
      experienceId: bookings.experienceId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new Error("normalized booking row missing");
  }
  if (booking.status !== expected.status) {
    throw new Error(`expected booking status ${expected.status}`);
  }
  if (booking.isSuperseded !== expected.superseded) {
    throw new Error("expected booking superseded flag mismatch");
  }
  if (booking.partySize !== expected.partySize) {
    throw new Error(`expected party size ${expected.partySize}`);
  }
  if (!booking.sessionId || !booking.experienceId) {
    throw new Error("expected session and experience links");
  }

  const [experience] = await database.db
    .select({ name: experiences.name })
    .from(experiences)
    .where(eq(experiences.id, booking.experienceId))
    .limit(1);
  if (experience?.name !== "SYNTHETIC mapped Goat Walk") {
    throw new Error("canonical experience name must stay the mapped Udderly name");
  }

  const [itemMapping] = await database.db
    .select({
      externalLabel: experienceSourceMappings.externalLabel,
    })
    .from(experienceSourceMappings)
    .where(
      and(
        eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
        eq(
          experienceSourceMappings.providerObjectType,
          FAREHARBOR_ITEM_OBJECT_TYPE,
        ),
        eq(experienceSourceMappings.externalId, SYNTHETIC_ITEM_PK),
      ),
    )
    .limit(1);
  if (itemMapping?.externalLabel !== "SYNTHETIC Goat Walk") {
    throw new Error("external_label should come from the FareHarbor item name");
  }

  const contacts = await database.db
    .select({ id: bookingContacts.id })
    .from(bookingContacts)
    .where(eq(bookingContacts.bookingId, bookingId));
  if (contacts.length !== 1) {
    throw new Error("expected one booking contact");
  }

  const members = await database.db
    .select({
      id: bookingPartyMembers.id,
      isActive: bookingPartyMembers.isActive,
      removedAt: bookingPartyMembers.removedAt,
    })
    .from(bookingPartyMembers)
    .where(eq(bookingPartyMembers.bookingId, bookingId));
  const active = members.filter((member) => member.isActive);
  const inactive = members.filter((member) => !member.isActive);
  if (active.length !== expected.activeMembers) {
    throw new Error("expected active party members were not normalized");
  }
  if (inactive.length !== expected.inactiveMembers) {
    throw new Error("expected inactive party members were not preserved");
  }
  if (inactive.some((member) => !member.removedAt)) {
    throw new Error("inactive party members must keep removed_at");
  }

  const customerIdentity = await database.db
    .select({
      internalEntityId: sourceIdentities.internalEntityId,
    })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        eq(sourceIdentities.entityType, FAREHARBOR_CUSTOMER_ENTITY),
        eq(sourceIdentities.externalId, "500001"),
      ),
    )
    .limit(1);
  if (customerIdentity[0]?.internalEntityId) {
    throw new Error("FareHarbor customer identity should remain unresolved");
  }

  return {
    bookingId,
    memberIds: members.map((member) => member.id).sort(),
  };
}

async function deleteSyntheticOperationalRows(
  database: DatabaseService,
): Promise<void> {
  const bookingIds = (
    await database.db
      .select({ internalEntityId: sourceIdentities.internalEntityId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          inArray(sourceIdentities.entityType, [
            FAREHARBOR_BOOKING_ENTITY,
            FAREHARBOR_BOOKING_PK_ENTITY,
          ]),
          inArray(sourceIdentities.externalId, [
            SYNTHETIC_BOOKING_UUID,
            "900001",
          ]),
        ),
      )
  )
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  if (bookingIds.length > 0) {
    await database.db
      .delete(bookingPartyMembers)
      .where(inArray(bookingPartyMembers.bookingId, bookingIds));
    await database.db
      .delete(bookingContacts)
      .where(inArray(bookingContacts.bookingId, bookingIds));
    await database.db
      .update(bookings)
      .set({
        rebookedFromBookingId: null,
        rebookedToBookingId: null,
      })
      .where(inArray(bookings.id, bookingIds));
    await database.db.delete(bookings).where(inArray(bookings.id, bookingIds));
  }

  const sessionId = await resolvedInternalId(
    database,
    FAREHARBOR_AVAILABILITY_ENTITY,
    "700001",
  );
  if (sessionId) {
    await database.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  const mappings = await database.db
    .select({
      id: experienceSourceMappings.id,
      experienceId: experienceSourceMappings.experienceId,
    })
    .from(experienceSourceMappings)
    .where(
      and(
        eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
        eq(
          experienceSourceMappings.providerObjectType,
          FAREHARBOR_ITEM_OBJECT_TYPE,
        ),
        eq(experienceSourceMappings.externalId, SYNTHETIC_ITEM_PK),
      ),
    );

  const experienceIds = [...new Set(mappings.map((row) => row.experienceId))];
  if (mappings.length > 0) {
    await database.db
      .delete(experienceSourceMappings)
      .where(
        inArray(
          experienceSourceMappings.id,
          mappings.map((row) => row.id),
        ),
      );
  }
  if (experienceIds.length > 0) {
    await database.db
      .delete(experiences)
      .where(inArray(experiences.id, experienceIds));
  }

  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        inArray(sourceIdentities.externalId, [
          SYNTHETIC_BOOKING_UUID,
          "900001",
          "700001",
          "500001",
          "500002",
          "600001",
        ]),
      ),
    );
}

async function resolvedInternalId(
  database: DatabaseService,
  entityType: string,
  externalId: string,
): Promise<string | undefined> {
  const rows = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        eq(sourceIdentities.entityType, entityType),
        eq(sourceIdentities.externalId, externalId),
      ),
    )
    .limit(1);

  return rows[0]?.internalEntityId ?? undefined;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
