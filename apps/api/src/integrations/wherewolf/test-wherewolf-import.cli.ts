import { NestFactory } from "@nestjs/core";
import { and, eq, inArray, like, or } from "drizzle-orm";
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
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { visits } from "../../database/schema/visits";
import {
  FAREHARBOR_BOOKING_ENTITY,
  FAREHARBOR_PROVIDER,
} from "../fareharbor/fareharbor.crypto";
import { INTERNAL_BOOKING as FH_INTERNAL_BOOKING } from "../fareharbor/fareharbor.constants";
import {
  WHEREWOLF_ACTIVITY_OBJECT_TYPE,
  WHEREWOLF_GUEST_ENTITY,
  WHEREWOLF_GUEST_VISIT_ENTITY,
  WHEREWOLF_PROVIDER,
} from "./wherewolf.constants";
import { visitOccurrenceIdentity } from "./wherewolf.occurrence";
import { farmDayRange } from "./wherewolf.range";
import { WherewolfImportService } from "./wherewolf-import.service";
import { WherewolfExperienceMapService } from "./wherewolf-experience-map.service";
import { WherewolfNormalizeService } from "./wherewolf-normalize.service";
import {
  formatWherewolfInspect,
  WherewolfInspectService,
} from "./wherewolf-inspect.service";

const ACTIVITY_ID = "990001";
const GUEST_LINKED = "880001";
const GUEST_WALKIN = "880002";
const GUEST_INSUFFICIENT = "880003";
const GUEST_EARLY = "880004";
const GUEST_LATE = "880005";
const GUEST_REPEAT = "880010";
const GUEST_STRING_ACTIVITY = "880020";
const RESERVATION_ID = "770001";
const RESERVATION_REPEAT_A = "770010";
const RESERVATION_REPEAT_B = "770011";
const FH_BOOKING_UUID = "00000000-0000-4000-b000-0000000000aa";
const EXPERIENCE_NAME = "SYNTHETIC WW Farm Glamping";

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const database = app.get(DatabaseService);
  const importer = app.get(WherewolfImportService);
  const mapper = app.get(WherewolfExperienceMapService);
  const normalizer = app.get(WherewolfNormalizeService);
  const inspector = app.get(WherewolfInspectService);

  try {
    await cleanup(database);

    const { sessionId, bookingId, experienceId } =
      await seedFareharborBooking(database);

    const range = farmDayRange("2026-09-15");
    const firstImport = await importer.persistFetched(
      range,
      { bookings: [linkedReservation()] },
      {
        guests: [
          linkedGuest("completed"),
          walkinGuest(),
          insufficientGuest(),
          earlyUtcGuest(),
          lateTorontoGuest(),
          repeatGuest(RESERVATION_REPEAT_A, "2026-09-15T18:00:00.000Z"),
          repeatGuest(RESERVATION_REPEAT_B, "2026-09-15T19:00:00.000Z"),
          stringActivityGuest(),
        ],
      },
    );
    if (firstImport.snapshotsInserted !== 9) {
      throw new Error("expected nine snapshots on first import");
    }
    const secondImport = await importer.persistFetched(
      range,
      { bookings: [linkedReservation()] },
      { guests: [linkedGuest("completed"), walkinGuest()] },
    );
    if (secondImport.snapshotsInserted !== 0) {
      throw new Error("duplicate import should not insert new snapshots");
    }
    console.log("- duplicate import does not create extra snapshots");

    await database.db
      .update(sourceSnapshots)
      .set({ observedAt: new Date("2026-09-14T12:00:00.000Z") })
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, WHEREWOLF_GUEST_ENTITY),
          eq(sourceSnapshots.externalId, GUEST_LINKED),
        ),
      );

    const linkedSnapshot = await latestGuestSnapshot(database, GUEST_LINKED);
    const unmapped = await normalizer.normalize({ snapshotId: linkedSnapshot });
    if (unmapped.results[0]?.outcome !== "mapping_required") {
      throw new Error("expected mapping required before activity is mapped");
    }
    if ((await visitCount(database, GUEST_LINKED)) !== 0) {
      throw new Error("unknown mapping must not create a visit");
    }
    console.log("- unknown activity mapping creates no visit");

    const mapped = await mapper.mapActivity({
      activityId: ACTIVITY_ID,
      experienceId,
    });
    if (mapped.outcome !== "created" && mapped.outcome !== "unchanged") {
      throw new Error("failed to map Wherewolf activity to existing experience");
    }

    const wrongDay = await normalizer.normalize({ date: "2026-09-14" });
    const wrongLinked = wrongDay.results.some(
      (row) =>
        row.outcome === "applied" && row.snapshotId === linkedSnapshot,
    );
    if (wrongLinked || (await visitCount(database, GUEST_LINKED)) !== 0) {
      throw new Error("observed_at must not select visits for a farm date");
    }
    console.log("- observed_at does not determine visit date");

    const farmDay = await normalizer.normalize({ date: "2026-09-15" });
    if (farmDay.skippedNoVisitDate < 1) {
      throw new Error("guests without visit timing should be excluded from --date");
    }
    const firstApply = farmDay.results.find(
      (row) => row.outcome === "applied" && row.snapshotId === linkedSnapshot,
    );
    if (
      firstApply?.outcome !== "applied" ||
      firstApply.bookingLinked !== true ||
      firstApply.sessionLinked !== true
    ) {
      throw new Error("expected explicit FareHarbor alias to link booking and session");
    }
    await assertVisit(database, GUEST_LINKED, RESERVATION_ID, {
      bookingId,
      sessionId,
      status: "completed",
      matchConfidence: "linked",
      visitedAt: "2026-09-15T14:00:00.000Z",
    });
    const earlySnapshot = await latestGuestSnapshot(database, GUEST_EARLY);
    if (
      farmDay.results.some(
        (row) => row.outcome === "applied" && row.snapshotId === earlySnapshot,
      )
    ) {
      throw new Error("UTC morning of 2026-09-15 is still the previous Toronto date");
    }
    if ((await visitCount(database, GUEST_LATE)) !== 1) {
      throw new Error("late Toronto evening should belong to 2026-09-15");
    }
    const stringSnapshot = await latestGuestSnapshot(
      database,
      GUEST_STRING_ACTIVITY,
    );
    const stringApply = farmDay.results.find(
      (row) => row.outcome === "applied" && row.snapshotId === stringSnapshot,
    );
    if (
      stringApply?.outcome !== "applied" ||
      stringApply.experienceName !== EXPERIENCE_NAME
    ) {
      throw new Error(
        "activities string ids must resolve the mapped canonical experience",
      );
    }
    const [stringPayload] = await database.db
      .select({ payload: sourceSnapshots.payload })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, stringSnapshot))
      .limit(1);
    if (
      !stringPayload ||
      "activitiesAsObjects" in stringPayload.payload ||
      JSON.stringify(stringPayload.payload.activities) !==
        JSON.stringify([ACTIVITY_ID])
    ) {
      throw new Error("string-activity guest snapshot shape was not preserved");
    }
    console.log("- America/Toronto date boundaries select the farm day");
    console.log("- activities string ids resolve the existing experience mapping");

    const again = await normalizer.normalize({ snapshotId: linkedSnapshot });
    if (again.results[0]?.outcome !== "applied") {
      throw new Error("expected idempotent normalize");
    }
    if ((await visitCount(database, GUEST_LINKED)) !== 1) {
      throw new Error("idempotent normalize created extra visits");
    }
    console.log("- normalizing the same occurrence twice keeps one visit");

    const changedImport = await importer.persistFetched(
      range,
      { bookings: [linkedReservation()] },
      { guests: [linkedGuest("checked-in")] },
    );
    if (changedImport.snapshotsInserted < 1) {
      throw new Error("changed guest state should insert a new snapshot");
    }
    const newerSnapshot = await latestGuestSnapshot(database, GUEST_LINKED);
    const stale = await normalizer.normalize({ snapshotId: linkedSnapshot });
    if (stale.results[0]?.outcome !== "skipped_stale") {
      throw new Error("older snapshot should be skipped");
    }
    const updated = await normalizer.normalize({ snapshotId: newerSnapshot });
    if (updated.results[0]?.outcome !== "applied") {
      throw new Error("newer snapshot should update the visit");
    }
    await assertVisit(database, GUEST_LINKED, RESERVATION_ID, {
      bookingId,
      sessionId,
      status: "checked-in",
      matchConfidence: "linked",
      visitedAt: "2026-09-15T14:00:00.000Z",
    });
    if ((await visitCount(database, GUEST_LINKED)) !== 1) {
      throw new Error("status update created a second visit");
    }
    console.log("- newer Wherewolf state updates the same visit occurrence");

    const walkinSnapshot = await latestGuestSnapshot(database, GUEST_WALKIN);
    const walkinResult = (await normalizer.normalize({ snapshotId: walkinSnapshot }))
      .results[0];
    if (walkinResult?.outcome !== "applied" || walkinResult.bookingLinked) {
      throw new Error("walk-in visit should remain unmatched");
    }
    await assertVisit(database, GUEST_WALKIN, "770099", {
      bookingId: null,
      sessionId: null,
      status: "completed",
      matchConfidence: "unmatched",
      visitedAt: "2026-09-15T15:00:00.000Z",
    });
    console.log("- absent booking evidence leaves booking_id null");

    if ((await visitCount(database, GUEST_REPEAT)) !== 2) {
      throw new Error("same guest id with two reservations must create two visits");
    }
    console.log("- same guest id with two reservations creates two visit occurrences");

    const insufficientSnapshot = await latestGuestSnapshot(
      database,
      GUEST_INSUFFICIENT,
    );
    const insufficient = await normalizer.normalize({
      snapshotId: insufficientSnapshot,
    });
    if (insufficient.results[0]?.outcome !== "insufficient_identity") {
      throw new Error("guest id without occurrence evidence must be skipped");
    }
    if ((await visitCount(database, GUEST_INSUFFICIENT)) !== 0) {
      throw new Error("signed=true must not create a visit without occurrence identity");
    }
    console.log("- insufficient occurrence identity is skipped; signed=true is not attendance");

    const snapshots = await database.db
      .select({ payload: sourceSnapshots.payload })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER));
    for (const row of snapshots) {
      const keys = Object.keys(row.payload);
      for (const banned of [
        "DOB",
        "signature",
        "ipAddress",
        "name",
        "email",
        "phoneNumber",
        "addressPostal",
      ]) {
        if (keys.includes(banned)) {
          throw new Error(`banned field ${banned} persisted in source_snapshot`);
        }
      }
    }
    console.log("- snapshots omit DOB, signature, IP, contact PII, and postal code");

    const inspect = await inspector.inspectDate("2026-09-15");
    const report = formatWherewolfInspect(inspect);
    if (inspect.guestSnapshots < 1) {
      throw new Error("inspect should count farm-day guest snapshots");
    }
    if (inspect.mappedActivity < 1) {
      throw new Error("inspect must count string-id activities as mapped");
    }
    for (const banned of [
      GUEST_LINKED,
      "SYNTHETIC",
      "@example",
      "N0N 0N0",
      "203.0.113",
    ]) {
      if (report.includes(banned)) {
        throw new Error(`inspect report leaked ${banned}`);
      }
    }
    if (!report.includes("signed=true is not attendance")) {
      throw new Error("inspect must state signed is not attendance");
    }
    console.log("- inspection output contains aggregate data only");
    console.log("- PERSON is not created");

    await cleanup(database);
    console.log("");
    console.log("Wherewolf synthetic import tests passed.");
  } finally {
    await app.close();
  }
}

function linkedGuest(status: string): Record<string, unknown> {
  return {
    id: GUEST_LINKED,
    DOB: "2010-01-01",
    name: "SYNTHETIC Linked Guest",
    email: "linked@example.invalid",
    ipAddress: "203.0.113.10",
    signature: "data:image/png;base64,AAAA",
    status,
    lastVisit: "2026-09-15T14:00:00.000Z",
    signed: true,
    minor: false,
    city: "Woodstock",
    addressPostal: "N0N 0N0",
    reservationsID: RESERVATION_ID,
    aliases: [FH_BOOKING_UUID],
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

function walkinGuest(): Record<string, unknown> {
  return {
    id: GUEST_WALKIN,
    name: "SYNTHETIC Walk-in",
    status: "completed",
    lastVisit: "2026-09-15T15:00:00.000Z",
    reservationsID: "770099",
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

function insufficientGuest(): Record<string, unknown> {
  return {
    id: GUEST_INSUFFICIENT,
    signed: true,
    status: "unknown",
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

function earlyUtcGuest(): Record<string, unknown> {
  return {
    id: GUEST_EARLY,
    status: "completed",
    lastVisit: "2026-09-15T03:00:00.000Z",
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

function lateTorontoGuest(): Record<string, unknown> {
  return {
    id: GUEST_LATE,
    status: "completed",
    lastVisit: "2026-09-16T03:00:00.000Z",
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

function stringActivityGuest(): Record<string, unknown> {
  return {
    id: GUEST_STRING_ACTIVITY,
    status: "completed",
    lastVisit: "2026-09-15T16:00:00.000Z",
    reservationsID: "770088",
    activities: [ACTIVITY_ID],
  };
}

function repeatGuest(
  reservationId: string,
  lastVisit: string,
): Record<string, unknown> {
  return {
    id: GUEST_REPEAT,
    status: "completed",
    lastVisit,
    reservationsID: reservationId,
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

function linkedReservation(): Record<string, unknown> {
  return {
    id: RESERVATION_ID,
    name: "SYNTHETIC Reservation Name",
    customer: {
      name: "SYNTHETIC Booker",
      email: "booker@example.invalid",
    },
    guests: [{ name: "should not persist" }],
    aliases: [FH_BOOKING_UUID],
    bookingLabel: FH_BOOKING_UUID,
    displayId: "WW-770001",
    status: "ok",
    activitiesAsObjects: [{ id: Number(ACTIVITY_ID), name: "SYNTHETIC WW Glamping" }],
  };
}

async function seedFareharborBooking(database: DatabaseService): Promise<{
  experienceId: string;
  sessionId: string;
  bookingId: string;
}> {
  const [experience] = await database.db
    .insert(experiences)
    .values({ name: EXPERIENCE_NAME, status: "active" })
    .returning({ id: experiences.id });
  const experienceId = experience?.id;
  if (!experienceId) {
    throw new Error("experience seed failed");
  }

  const [session] = await database.db
    .insert(sessions)
    .values({
      experienceId,
      startAt: new Date("2026-09-15T14:00:00.000Z"),
      status: "available",
    })
    .returning({ id: sessions.id });
  const sessionId = session?.id;
  if (!sessionId) {
    throw new Error("session seed failed");
  }

  const [booking] = await database.db
    .insert(bookings)
    .values({
      sessionId,
      experienceId,
      status: "booked",
      partySize: 1,
    })
    .returning({ id: bookings.id });
  const bookingId = booking?.id;
  if (!bookingId) {
    throw new Error("booking seed failed");
  }

  await database.db.insert(sourceIdentities).values({
    provider: FAREHARBOR_PROVIDER,
    entityType: FAREHARBOR_BOOKING_ENTITY,
    externalId: FH_BOOKING_UUID,
    internalEntityType: FH_INTERNAL_BOOKING,
    internalEntityId: bookingId,
  });

  return { experienceId, sessionId, bookingId };
}

async function latestGuestSnapshot(
  database: DatabaseService,
  guestId: string,
): Promise<string> {
  const rows = await database.db
    .select({
      id: sourceSnapshots.id,
      observedAt: sourceSnapshots.observedAt,
    })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
        eq(sourceSnapshots.entityType, WHEREWOLF_GUEST_ENTITY),
        eq(sourceSnapshots.externalId, guestId),
      ),
    );
  const latest = rows.sort(
    (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
  )[0];
  if (!latest) {
    throw new Error(`missing snapshot for guest ${guestId}`);
  }
  return latest.id;
}

async function visitCount(
  database: DatabaseService,
  guestId: string,
): Promise<number> {
  const identities = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, WHEREWOLF_PROVIDER),
        eq(sourceIdentities.entityType, WHEREWOLF_GUEST_VISIT_ENTITY),
        like(sourceIdentities.externalId, `${guestId}:%`),
      ),
    );
  const ids = identities
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  return ids.length === 0
    ? 0
    : (
        await database.db
          .select({ id: visits.id })
          .from(visits)
          .where(inArray(visits.id, ids))
      ).length;
}

async function assertVisit(
  database: DatabaseService,
  guestId: string,
  reservationId: string | undefined,
  expected: {
    bookingId: string | null;
    sessionId: string | null;
    status: string;
    matchConfidence: string;
    visitedAt: string;
  },
): Promise<void> {
  const occurrence = visitOccurrenceIdentity(guestId, {
    reservationsID: reservationId,
    lastVisit: expected.visitedAt,
  });
  if (!occurrence) {
    throw new Error("expected occurrence identity in assertion");
  }
  const [identity] = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, WHEREWOLF_PROVIDER),
        eq(sourceIdentities.entityType, WHEREWOLF_GUEST_VISIT_ENTITY),
        eq(sourceIdentities.externalId, occurrence.key),
      ),
    )
    .limit(1);
  const visitId = identity?.internalEntityId;
  if (!visitId) {
    throw new Error("visit identity missing");
  }
  const [visit] = await database.db
    .select()
    .from(visits)
    .where(eq(visits.id, visitId))
    .limit(1);
  if (!visit) {
    throw new Error("visit row missing");
  }
  if ((visit.bookingId ?? null) !== expected.bookingId) {
    throw new Error("visit booking_id mismatch");
  }
  if ((visit.sessionId ?? null) !== expected.sessionId) {
    throw new Error("visit session_id mismatch");
  }
  if (visit.status !== expected.status) {
    throw new Error("visit status mismatch");
  }
  if (visit.matchConfidence !== expected.matchConfidence) {
    throw new Error("visit match_confidence mismatch");
  }
  if (visit.visitedAt?.toISOString() !== expected.visitedAt) {
    throw new Error("visit visited_at mismatch");
  }
  if (visit.postal !== null) {
    throw new Error("visit.postal must stay null");
  }
}

async function cleanup(database: DatabaseService): Promise<void> {
  const guestIds = [
    GUEST_LINKED,
    GUEST_WALKIN,
    GUEST_INSUFFICIENT,
    GUEST_EARLY,
    GUEST_LATE,
    GUEST_REPEAT,
    GUEST_STRING_ACTIVITY,
  ];
  const visitIdentities = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, WHEREWOLF_PROVIDER),
        eq(sourceIdentities.entityType, WHEREWOLF_GUEST_VISIT_ENTITY),
        or(
          ...guestIds.map((guestId) =>
            like(sourceIdentities.externalId, `${guestId}:%`),
          ),
        ),
      ),
    );
  const visitIds = visitIdentities
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  if (visitIds.length > 0) {
    await database.db.delete(visits).where(inArray(visits.id, visitIds));
  }

  await database.db
    .delete(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
        inArray(sourceSnapshots.externalId, [
          ...guestIds,
          RESERVATION_ID,
          RESERVATION_REPEAT_A,
          RESERVATION_REPEAT_B,
          "770099",
          "770088",
        ]),
      ),
    );

  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, WHEREWOLF_PROVIDER),
        or(
          inArray(sourceIdentities.externalId, [
            ...guestIds,
            RESERVATION_ID,
            RESERVATION_REPEAT_A,
            RESERVATION_REPEAT_B,
            FH_BOOKING_UUID,
            "770099",
            "770088",
          ]),
          ...guestIds.map((guestId) =>
            like(sourceIdentities.externalId, `${guestId}:%`),
          ),
        ),
      ),
    );

  const fhIdentities = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        eq(sourceIdentities.externalId, FH_BOOKING_UUID),
      ),
    );
  const bookingIds = fhIdentities
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  if (bookingIds.length > 0) {
    await database.db
      .delete(bookingPartyMembers)
      .where(inArray(bookingPartyMembers.bookingId, bookingIds));
    await database.db
      .delete(bookingContacts)
      .where(inArray(bookingContacts.bookingId, bookingIds));
    await database.db.delete(bookings).where(inArray(bookings.id, bookingIds));
  }

  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        eq(sourceIdentities.externalId, FH_BOOKING_UUID),
      ),
    );

  const mappings = await database.db
    .select({
      id: experienceSourceMappings.id,
      experienceId: experienceSourceMappings.experienceId,
    })
    .from(experienceSourceMappings)
    .where(
      and(
        eq(experienceSourceMappings.provider, WHEREWOLF_PROVIDER),
        eq(
          experienceSourceMappings.providerObjectType,
          WHEREWOLF_ACTIVITY_OBJECT_TYPE,
        ),
        eq(experienceSourceMappings.externalId, ACTIVITY_ID),
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

  const named = await database.db
    .select({ id: experiences.id })
    .from(experiences)
    .where(eq(experiences.name, EXPERIENCE_NAME));
  const allExperienceIds = [
    ...new Set([...experienceIds, ...named.map((row) => row.id)]),
  ];
  if (allExperienceIds.length > 0) {
    await database.db
      .delete(sessions)
      .where(inArray(sessions.experienceId, allExperienceIds));
    await database.db
      .delete(experiences)
      .where(inArray(experiences.id, allExperienceIds));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
