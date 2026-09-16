import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { sourceObjectClassifications } from "../../database/schema/source-object-classification";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { FareharborExperienceMapService } from "./fareharbor-experience-map.service";
import { FareharborNormalizer } from "./fareharbor-normalizer";
import { FareharborReportImportService } from "./fareharbor-report-import.service";
import { FareharborReportItemClassifyService } from "./fareharbor-report-item-classify.service";
import { FareharborIdentityConflictError } from "./fareharbor-identity";
import {
  FAREHARBOR_AVAILABILITY_ENTITY,
  FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
  FAREHARBOR_BOOKING_PK_ENTITY,
  FAREHARBOR_ITEM_OBJECT_TYPE,
  FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
  FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
  INTERNAL_BOOKING,
} from "./fareharbor.constants";
import {
  FAREHARBOR_BOOKING_ENTITY,
  FAREHARBOR_PROVIDER,
} from "./fareharbor.crypto";
import { FAREHARBOR_REPORT_HEADERS } from "./fareharbor-report.parse";
import { extractFareharborBookingSnapshot } from "./fareharbor.snapshot";
import { createSyntheticFareharborBookingPayload } from "./fareharbor.synthetic";

const EXPERIENCE_NAME = "SYNTHETIC report Goat Recess";
const ITEM_LABEL = "SYNTHETIC Goat Recess";
const NON_EXPERIENCE_LABEL = "SYNTHETIC Gift Card";
const UNKNOWN_LABEL = "SYNTHETIC Unmapped Hayride";
const BOOKING_PK = "378957692";
const CANCELLED_PK = "378957693";
const UNKNOWN_PK = "378957694";
const GIFT_PK = "378957695";
const SECOND_PK = "378957696";
const WEBHOOK_UUID = "00000000-0000-4000-c000-0000000000f1";
const CONFLICT_UUID = "00000000-0000-4000-c000-0000000000f2";
const ITEM_PK = "600091";
const AVAIL_PK = "700091";
const AVAIL_CONFLICT_PK = "700092";

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const database = app.get(DatabaseService);
  const importer = app.get(FareharborReportImportService);
  const mapper = app.get(FareharborExperienceMapService);
  const classifier = app.get(FareharborReportItemClassifyService);
  const normalizer = app.get(FareharborNormalizer);

  try {
    await cleanup(database);

    const classified = await classifier.classifyNonExperience(
      NON_EXPERIENCE_LABEL,
    );
    if (classified.outcome !== "created") {
      throw new Error("expected non-experience classification");
    }
    const classifiedAgain = await classifier.classifyNonExperience(
      NON_EXPERIENCE_LABEL,
    );
    if (classifiedAgain.outcome !== "unchanged") {
      throw new Error("expected idempotent classification");
    }

    const mapped = await mapper.mapReportItem({
      itemLabel: ITEM_LABEL,
      name: EXPERIENCE_NAME,
    });
    if (mapped.outcome !== "created" || !mapped.createdExperience) {
      throw new Error("expected report item mapping");
    }
    const mappedAgain = await mapper.mapReportItem({
      itemLabel: ITEM_LABEL,
      name: EXPERIENCE_NAME,
    });
    if (mappedAgain.outcome !== "unchanged") {
      throw new Error("expected idempotent report item mapping");
    }
    const remap = await mapper.mapReportItem({
      itemLabel: ITEM_LABEL,
      name: "SYNTHETIC other report experience",
    });
    if (remap.outcome !== "conflict") {
      throw new Error("expected conflicting report item remap to stop");
    }

    const csvPath = await writeSyntheticCsv();
    const before = await countOperational(database);
    const dryRun = await importer.importFile(csvPath, { dryRun: true });
    if (dryRun.outcome !== "ok" || !dryRun.dryRun) {
      throw new Error("expected successful dry run");
    }
    assertCounts(dryRun, {
      rows: 5,
      cancelled: 1,
      totalPax: 10,
      mappedExperienceRows: 3,
      nonExperienceSkipped: 1,
      unknownItemRows: 1,
      invalidRows: 0,
    });
    if (!dryRun.unknownItemLabels.includes(UNKNOWN_LABEL)) {
      throw new Error("dry run must list unknown item labels");
    }
    const afterDry = await countOperational(database);
    if (JSON.stringify(before) !== JSON.stringify(afterDry)) {
      throw new Error("dry run made database writes");
    }
    console.log("- dry run validates the file and writes nothing");

    const imported = await importer.importFile(csvPath, { dryRun: false });
    if (imported.outcome !== "ok" || imported.applied !== 3) {
      throw new Error("expected three mapped rows to apply");
    }
    assertCounts(imported, {
      rows: 5,
      cancelled: 1,
      totalPax: 10,
      mappedExperienceRows: 3,
      nonExperienceSkipped: 1,
      unknownItemRows: 1,
      invalidRows: 0,
    });

    const active = await loadBooking(database, BOOKING_PK);
    if (
      active.status !== "booked" ||
      active.partySize !== 4 ||
      active.sourceType !== "online" ||
      !active.sessionId ||
      !active.experienceId
    ) {
      throw new Error("active booking fields were not imported");
    }
    if (active.bookedAt.toISOString() !== "2026-09-12T18:00:00.000Z") {
      throw new Error("booked_at must be America/Toronto");
    }

    const cancelled = await loadBooking(database, CANCELLED_PK);
    if (cancelled.status !== "cancelled" || !cancelled.cancelledAt) {
      throw new Error("cancelled booking was not imported");
    }

    const second = await loadBooking(database, SECOND_PK);
    if (second.sourceType !== "internal") {
      throw new Error("staff Last Booked By must not become a name source_type");
    }
    if (second.sessionId !== active.sessionId) {
      throw new Error("same experience/start must reuse the report session");
    }

    const session = await loadSession(database, active.sessionId);
    if (session.endAt !== null || session.capacity !== null || session.status !== null) {
      throw new Error("report sessions must not invent end, capacity, or status");
    }
    if (session.startAt.toISOString() !== "2026-09-12T19:00:00.000Z") {
      throw new Error("session start_at must be America/Toronto");
    }

    const contacts = await database.db
      .select({
        id: bookingContacts.id,
        email: bookingContacts.email,
        smsOptIn: bookingContacts.smsOptIn,
      })
      .from(bookingContacts)
      .where(eq(bookingContacts.bookingId, active.id));
    if (contacts.length !== 1 || contacts[0]?.smsOptIn !== null) {
      throw new Error("expected one booking contact with null sms opt-in");
    }

    const members = await database.db
      .select({ id: bookingPartyMembers.id })
      .from(bookingPartyMembers)
      .where(
        inArray(bookingPartyMembers.bookingId, [
          active.id,
          cancelled.id,
          second.id,
        ]),
      );
    if (members.length !== 0) {
      throw new Error("report import must not fabricate party members");
    }

    if (await resolvedId(database, FAREHARBOR_BOOKING_PK_ENTITY, UNKNOWN_PK)) {
      throw new Error("unknown item label wrote a booking");
    }
    if (await resolvedId(database, FAREHARBOR_BOOKING_PK_ENTITY, GIFT_PK)) {
      throw new Error("non-experience label wrote a booking");
    }

    const snapshots = await database.db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.provider, FAREHARBOR_PROVIDER));
    if (snapshots.length !== 0) {
      throw new Error("CSV must not be copied into source_snapshot");
    }

    const reportKeyIdentities = await database.db
      .select({ entityType: sourceIdentities.entityType })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          eq(
            sourceIdentities.entityType,
            FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
          ),
        ),
      );
    if (reportKeyIdentities.length !== 1) {
      throw new Error("expected one report-derived session identity");
    }

    const again = await importer.importFile(csvPath, { dryRun: false });
    if (again.applied !== 3) {
      throw new Error("reimport should apply the mapped rows again");
    }
    const afterAgain = await countOperational(database);
    if (
      afterAgain.bookings !== 3 ||
      afterAgain.sessions !== 1 ||
      afterAgain.contacts !== 3 ||
      afterAgain.members !== 0
    ) {
      throw new Error("reimport created duplicates");
    }
    console.log("- import is idempotent and does not fabricate party members");

    const itemMap = await mapper.mapItem({
      itemId: ITEM_PK,
      experienceId: mapped.experienceId,
    });
    if (itemMap.outcome !== "created") {
      throw new Error("expected webhook item mapping onto the same experience");
    }

    const webhookBody = createSyntheticFareharborBookingPayload({
      uuid: WEBHOOK_UUID,
      pk: Number(BOOKING_PK),
      customer_count: 4,
      source: "online",
      created_at: "2026-09-12T18:00:00.000Z",
      availability: {
        pk: Number(AVAIL_PK),
        start_at: "2026-09-12T15:00:00-04:00",
        end_at: "2026-09-12T16:00:00-04:00",
        capacity: 12,
        online_booking_status: "available",
        item: { pk: Number(ITEM_PK), name: ITEM_LABEL },
      },
      customers: [],
    });
    const snapshot = extractFareharborBookingSnapshot(webhookBody);
    await database.db.transaction(async (tx) => {
      const applied = await normalizer.apply(tx, snapshot, new Date());
      if (applied.outcome !== "applied") {
        throw new Error("expected webhook normalize to apply onto historical booking");
      }
    });

    const converged = await loadBooking(database, BOOKING_PK);
    if (converged.id !== active.id) {
      throw new Error("webhook created a duplicate booking for booking_pk");
    }
    const uuidId = await resolvedId(
      database,
      FAREHARBOR_BOOKING_ENTITY,
      WEBHOOK_UUID,
    );
    if (uuidId !== active.id) {
      throw new Error("webhook uuid must attach to the historical booking");
    }
    if (converged.sessionId !== active.sessionId) {
      throw new Error("webhook created a duplicate session");
    }
    const availabilitySession = await resolvedId(
      database,
      FAREHARBOR_AVAILABILITY_ENTITY,
      AVAIL_PK,
    );
    if (availabilitySession !== active.sessionId) {
      throw new Error("availability.pk must attach to the historical session");
    }
    const filled = await loadSession(database, active.sessionId);
    if (filled.endAt === null || filled.capacity !== 12) {
      throw new Error("webhook should fill previously unknown session fields");
    }
    console.log("- historical booking_pk and session converge with webhook identities");

    const conflictBooking = await database.db
      .insert(bookings)
      .values({
        experienceId: mapped.experienceId,
        status: "booked",
        partySize: 1,
      })
      .returning({ id: bookings.id });
    const conflictId = conflictBooking[0]?.id;
    if (!conflictId) {
      throw new Error("failed to seed conflicting booking");
    }
    await database.db.insert(sourceIdentities).values({
      provider: FAREHARBOR_PROVIDER,
      entityType: FAREHARBOR_BOOKING_ENTITY,
      externalId: CONFLICT_UUID,
      internalEntityType: INTERNAL_BOOKING,
      internalEntityId: conflictId,
    });

    const conflictBody = createSyntheticFareharborBookingPayload({
      uuid: CONFLICT_UUID,
      pk: Number(BOOKING_PK),
      availability: {
        pk: Number(AVAIL_CONFLICT_PK),
        start_at: "2026-09-12T15:00:00-04:00",
        item: { pk: Number(ITEM_PK), name: ITEM_LABEL },
      },
      customers: [],
    });
    let conflicted = false;
    try {
      await database.db.transaction(async (tx) => {
        await normalizer.apply(
          tx,
          extractFareharborBookingSnapshot(conflictBody),
          new Date(),
        );
      });
    } catch (error: unknown) {
      conflicted = error instanceof FareharborIdentityConflictError;
      if (!conflicted) {
        throw error;
      }
    }
    if (!conflicted) {
      throw new Error("expected booking identity conflict");
    }
    const stillHistorical = await loadBooking(database, BOOKING_PK);
    if (stillHistorical.id !== active.id) {
      throw new Error("identity conflict merged bookings");
    }
    console.log("- uuid/pk identity conflict fails without merging");

    await cleanup(database);
    console.log("");
    console.log("FareHarbor historical report importer tests passed.");
  } finally {
    await app.close();
  }
}

function assertCounts(
  summary: {
    rows: number;
    cancelled: number;
    totalPax: number;
    mappedExperienceRows: number;
    nonExperienceSkipped: number;
    unknownItemRows: number;
    invalidRows: number;
  },
  expected: {
    rows: number;
    cancelled: number;
    totalPax: number;
    mappedExperienceRows: number;
    nonExperienceSkipped: number;
    unknownItemRows: number;
    invalidRows: number;
  },
): void {
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (summary[key] !== expected[key]) {
      throw new Error(`expected ${key}=${expected[key]}, got ${summary[key]}`);
    }
  }
}

async function writeSyntheticCsv(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fh-report-"));
  const path = join(dir, "synthetic-bookings.csv");
  const rows = [
    ["Bookings"],
    [...FAREHARBOR_REPORT_HEADERS],
    reportRow({
      bookingId: `#${BOOKING_PK}`,
      cancelled: "No",
      lastBookedBy: "Online",
      item: ITEM_LABEL,
      pax: "4",
    }),
    reportRow({
      bookingId: `#${CANCELLED_PK}`,
      cancelled: "Cancelled",
      cancelledAt: "2026-09-13 09:00am",
      lastBookedBy: "Online",
      item: ITEM_LABEL,
      pax: "1",
    }),
    reportRow({
      bookingId: `#${GIFT_PK}`,
      cancelled: "No",
      lastBookedBy: "Online",
      item: NON_EXPERIENCE_LABEL,
      pax: "1",
    }),
    reportRow({
      bookingId: `#${UNKNOWN_PK}`,
      cancelled: "No",
      lastBookedBy: "Online",
      item: UNKNOWN_LABEL,
      pax: "2",
    }),
    reportRow({
      bookingId: `#${SECOND_PK}`,
      cancelled: "No",
      lastBookedBy: "Jane Desk",
      item: ITEM_LABEL,
      pax: "2",
    }),
    reportRow({
      bookingId: "",
      cancelled: "",
      lastBookedBy: "",
      item: "",
      pax: "10",
      availability: "",
      lastBookedAt: "",
    }),
  ];
  const content = rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
        )
        .join(","),
    )
    .join("\n");
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  return path;
}

function reportRow(input: {
  bookingId: string;
  cancelled: string;
  lastBookedBy: string;
  item: string;
  pax: string;
  cancelledAt?: string;
  availability?: string;
  lastBookedAt?: string;
}): string[] {
  const byHeader: Record<string, string> = {
    "Booking ID": input.bookingId,
    "Cancelled?": input.cancelled,
    "Last Booked At": input.lastBookedAt ?? "2026-09-12 02:00pm",
    "Last Booked By": input.lastBookedBy,
    "Cancelled At": input.cancelledAt ?? "",
    Item: input.item,
    Availability: input.availability ?? "2026-09-12 @ 03:00pm",
    Contact: "SYNTHETIC Report Booker",
    Phone: "+10000000000",
    "Contact Language": "en",
    "Country by phone": "US",
    Email: "synthetic.report@example.invalid",
    "Subscribed to Email?": "Yes",
    "Booking Notes": "secret notes must not be stored",
    "Booking Cancellation Notes": "secret cancel notes",
    "# of Pax": input.pax,
    "Online Booking Reference": "REF-IGNORE",
    Subtotal: "99.00",
    "Total Tax": "1.00",
    Total: "100.00",
    "Total Tax Paid": "1.00",
    "Total Paid": "100.00",
    Affiliate: "",
    Agent: "",
    Desk: "",
    "Invoice Total": "100.00",
    "Payable to Affiliate": "",
    "Paid to Affiliate": "",
    "Receivable from Affiliate": "",
    "Received from Affiliate": "",
  };
  return FAREHARBOR_REPORT_HEADERS.map((header) => byHeader[header] ?? "");
}

async function loadBooking(
  database: DatabaseService,
  bookingPk: string,
): Promise<{
  id: string;
  status: string;
  partySize: number | null;
  sourceType: string | null;
  sessionId: string | null;
  experienceId: string | null;
  bookedAt: Date;
  cancelledAt: Date | null;
}> {
  const bookingId = await resolvedId(
    database,
    FAREHARBOR_BOOKING_PK_ENTITY,
    bookingPk,
  );
  if (!bookingId) {
    throw new Error(`missing booking ${bookingPk}`);
  }
  const [row] = await database.db
    .select({
      id: bookings.id,
      status: bookings.status,
      partySize: bookings.partySize,
      sourceType: bookings.sourceType,
      sessionId: bookings.sessionId,
      experienceId: bookings.experienceId,
      bookedAt: bookings.bookedAt,
      cancelledAt: bookings.cancelledAt,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row?.bookedAt) {
    throw new Error("booking row missing");
  }
  return { ...row, bookedAt: row.bookedAt };
}

async function loadSession(
  database: DatabaseService,
  sessionId: string,
): Promise<{
  startAt: Date;
  endAt: Date | null;
  capacity: number | null;
  status: string | null;
}> {
  const [row] = await database.db
    .select({
      startAt: sessions.startAt,
      endAt: sessions.endAt,
      capacity: sessions.capacity,
      status: sessions.status,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) {
    throw new Error("session row missing");
  }
  return row;
}

async function countOperational(database: DatabaseService): Promise<{
  bookings: number;
  sessions: number;
  contacts: number;
  members: number;
  identities: number;
}> {
  const pks = [BOOKING_PK, CANCELLED_PK, UNKNOWN_PK, GIFT_PK, SECOND_PK];
  const bookingIds = (
    await database.db
      .select({ internalEntityId: sourceIdentities.internalEntityId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          eq(sourceIdentities.entityType, FAREHARBOR_BOOKING_PK_ENTITY),
          inArray(sourceIdentities.externalId, pks),
        ),
      )
  )
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  const memberRows =
    bookingIds.length === 0
      ? []
      : await database.db
          .select({ id: bookingPartyMembers.id })
          .from(bookingPartyMembers)
          .where(inArray(bookingPartyMembers.bookingId, bookingIds));
  const contactRows =
    bookingIds.length === 0
      ? []
      : await database.db
          .select({ id: bookingContacts.id })
          .from(bookingContacts)
          .where(inArray(bookingContacts.bookingId, bookingIds));
  const sessionIds = (
    await database.db
      .select({ internalEntityId: sourceIdentities.internalEntityId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          inArray(sourceIdentities.entityType, [
            FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
            FAREHARBOR_AVAILABILITY_ENTITY,
          ]),
          inArray(sourceIdentities.externalId, [AVAIL_PK, AVAIL_CONFLICT_PK]),
        ),
      )
  )
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  const reportSessions = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        eq(
          sourceIdentities.entityType,
          FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
        ),
        like(
          sourceIdentities.externalId,
          "%:2026-09-12T19:00:00.000Z",
        ),
      ),
    );

  return {
    bookings: bookingIds.length,
    sessions: new Set(
      [...sessionIds, ...reportSessions.map((row) => row.internalEntityId)].filter(
        (id): id is string => Boolean(id),
      ),
    ).size,
    contacts: contactRows.length,
    members: memberRows.length,
    identities: 0,
  };
}

async function resolvedId(
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

async function cleanup(database: DatabaseService): Promise<void> {
  const externalIds = [
    BOOKING_PK,
    CANCELLED_PK,
    UNKNOWN_PK,
    GIFT_PK,
    SECOND_PK,
    WEBHOOK_UUID,
    CONFLICT_UUID,
    AVAIL_PK,
    AVAIL_CONFLICT_PK,
    ITEM_PK,
  ];
  const bookingIds = (
    await database.db
      .select({
        internalEntityId: sourceIdentities.internalEntityId,
        entityType: sourceIdentities.entityType,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          inArray(sourceIdentities.entityType, [
            FAREHARBOR_BOOKING_ENTITY,
            FAREHARBOR_BOOKING_PK_ENTITY,
          ]),
          inArray(sourceIdentities.externalId, externalIds),
        ),
      )
  )
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  const sessionIds = (
    await database.db
      .select({ internalEntityId: sourceIdentities.internalEntityId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          or(
            and(
              eq(
                sourceIdentities.entityType,
                FAREHARBOR_AVAILABILITY_ENTITY,
              ),
              inArray(sourceIdentities.externalId, [
                AVAIL_PK,
                AVAIL_CONFLICT_PK,
              ]),
            ),
            and(
              eq(
                sourceIdentities.entityType,
                FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
              ),
              like(
                sourceIdentities.externalId,
                "%:2026-09-12T19:00:00.000Z",
              ),
            ),
          ),
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
      .set({ rebookedFromBookingId: null, rebookedToBookingId: null })
      .where(inArray(bookings.id, bookingIds));
    await database.db.delete(bookings).where(inArray(bookings.id, bookingIds));
  }

  if (sessionIds.length > 0) {
    const remaining = await database.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(inArray(bookings.sessionId, sessionIds));
    if (remaining.length === 0) {
      await database.db.delete(sessions).where(inArray(sessions.id, sessionIds));
    }
  }

  await database.db
    .delete(experienceSourceMappings)
    .where(
      and(
        eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
        inArray(experienceSourceMappings.providerObjectType, [
          FAREHARBOR_ITEM_OBJECT_TYPE,
          FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
        ]),
        inArray(experienceSourceMappings.externalId, [ITEM_LABEL, ITEM_PK]),
      ),
    );
  await database.db
    .delete(sourceObjectClassifications)
    .where(
      and(
        eq(sourceObjectClassifications.provider, FAREHARBOR_PROVIDER),
        eq(
          sourceObjectClassifications.classification,
          FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
        ),
        eq(sourceObjectClassifications.externalId, NON_EXPERIENCE_LABEL),
      ),
    );
  await database.db
    .delete(experiences)
    .where(
      inArray(experiences.name, [
        EXPERIENCE_NAME,
        "SYNTHETIC other report experience",
      ]),
    );
  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        inArray(sourceIdentities.externalId, externalIds),
      ),
    );
  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
        eq(
          sourceIdentities.entityType,
          FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
        ),
        like(sourceIdentities.externalId, "%:2026-09-12T19:00:00.000Z"),
      ),
    );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
