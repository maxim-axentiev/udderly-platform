import { readFile } from "node:fs/promises";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import {
  bookingContacts,
  bookings,
} from "../../database/schema/bookings";
import {
  experienceSourceMappings,
  sessions,
} from "../../database/schema/experiences";
import { sourceObjectClassifications } from "../../database/schema/source-object-classification";
import { FAREHARBOR_PROVIDER } from "./fareharbor.crypto";
import {
  FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
  FAREHARBOR_BOOKING_PK_ENTITY,
  FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION,
  FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
  INTERNAL_BOOKING,
  INTERNAL_SESSION,
} from "./fareharbor.constants";
import {
  fareharborAvailabilityReportKey,
  findResolvedFareharborIdentity,
  upsertFareharborIdentity,
  type FareharborDb,
} from "./fareharbor-identity";
import {
  parseFareharborBookingsCsv,
  type FareharborReportRow,
} from "./fareharbor-report.parse";
import { parseFarmDateTime } from "./fareharbor-report.time";

export type FareharborReportImportSummary = {
  outcome: "ok" | "invalid_file";
  reason?: "title" | "headers" | "empty" | "unreadable";
  dryRun: boolean;
  rows: number;
  bookings: number;
  cancelled: number;
  totalPax: number;
  mappedExperienceRows: number;
  applied: number;
  nonExperienceSkipped: number;
  unknownItemLabels: string[];
  unknownItemRows: number;
  conflictingItemLabels: string[];
  invalidRows: number;
};

type PreparedRow =
  | { kind: "invalid" }
  | { kind: "unknown"; itemLabel: string }
  | { kind: "conflict"; itemLabel: string }
  | { kind: "non_experience" }
  | {
      kind: "mapped";
      row: FareharborReportRow;
      experienceId: string;
      bookingPk: string;
      partySize: number;
      bookedAt: Date;
      cancelledAt?: Date;
      startAt: Date;
      sourceType: string;
      emailMarketingOptIn?: boolean;
    };

@Injectable()
export class FareharborReportImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async importFile(
    filePath: string,
    options: { dryRun: boolean },
  ): Promise<FareharborReportImportSummary> {
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      return emptySummary("invalid_file", options.dryRun, "unreadable");
    }

    const parsed = parseFareharborBookingsCsv(content);
    if (parsed.outcome !== "ok") {
      return emptySummary("invalid_file", options.dryRun, parsed.reason);
    }

    const lookups = await this.loadLookups();
    const unknownLabels = new Set<string>();
    const conflictingLabels = new Set<string>();
    let cancelled = 0;
    let totalPax = 0;
    let mappedExperienceRows = 0;
    let nonExperienceSkipped = 0;
    let unknownItemRows = 0;
    let invalidRows = 0;
    let applied = 0;

    const prepared: PreparedRow[] = parsed.rows.map((row) => {
      if (row.cancelled) {
        cancelled += 1;
      }
      const pax = parseNonNegativeInteger(row.paxRaw);
      if (pax !== undefined) {
        totalPax += pax;
      }

      const ready = this.prepareRow(row, lookups);
      if (ready.kind === "invalid") {
        invalidRows += 1;
      } else if (ready.kind === "unknown") {
        unknownItemRows += 1;
        unknownLabels.add(ready.itemLabel);
      } else if (ready.kind === "conflict") {
        invalidRows += 1;
        conflictingLabels.add(ready.itemLabel);
      } else if (ready.kind === "non_experience") {
        nonExperienceSkipped += 1;
      } else {
        mappedExperienceRows += 1;
      }
      return ready;
    });

    if (!options.dryRun) {
      for (const item of prepared) {
        if (item.kind !== "mapped") {
          continue;
        }
        await this.database.db.transaction(async (tx) => {
          await this.applyMappedRow(tx, item);
        });
        applied += 1;
      }
    }

    return {
      outcome: "ok",
      dryRun: options.dryRun,
      rows: parsed.rows.length,
      bookings: parsed.rows.length,
      cancelled,
      totalPax,
      mappedExperienceRows,
      applied: options.dryRun ? 0 : applied,
      nonExperienceSkipped,
      unknownItemLabels: [...unknownLabels].sort(),
      unknownItemRows,
      conflictingItemLabels: [...conflictingLabels].sort(),
      invalidRows,
    };
  }

  private async loadLookups(): Promise<{
    experiences: Map<string, string>;
    classifications: Map<string, string>;
  }> {
    const mappings = await this.database.db
      .select({
        externalId: experienceSourceMappings.externalId,
        experienceId: experienceSourceMappings.experienceId,
      })
      .from(experienceSourceMappings)
      .where(
        and(
          eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
          eq(
            experienceSourceMappings.providerObjectType,
            FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
          ),
        ),
      );

    const classifications = await this.database.db
      .select({
        externalId: sourceObjectClassifications.externalId,
        classification: sourceObjectClassifications.classification,
      })
      .from(sourceObjectClassifications)
      .where(
        and(
          eq(sourceObjectClassifications.provider, FAREHARBOR_PROVIDER),
          eq(
            sourceObjectClassifications.providerObjectType,
            FAREHARBOR_REPORT_ITEM_OBJECT_TYPE,
          ),
        ),
      );

    return {
      experiences: new Map(
        mappings.map((row) => [row.externalId, row.experienceId]),
      ),
      classifications: new Map(
        classifications.map((row) => [row.externalId, row.classification]),
      ),
    };
  }

  private prepareRow(
    row: FareharborReportRow,
    lookups: {
      experiences: Map<string, string>;
      classifications: Map<string, string>;
    },
  ): PreparedRow {
    if (
      !row.bookingPk ||
      !row.itemLabel ||
      !row.availabilityRaw ||
      !row.lastBookedAtRaw
    ) {
      return { kind: "invalid" };
    }

    const partySize = parseNonNegativeInteger(row.paxRaw);
    const bookedAt = parseFarmDateTime(row.lastBookedAtRaw);
    const startAt = parseFarmDateTime(row.availabilityRaw);
    if (partySize === undefined || !bookedAt || !startAt) {
      return { kind: "invalid" };
    }

    let cancelledAt: Date | undefined;
    if (row.cancelledAtRaw) {
      cancelledAt = parseFarmDateTime(row.cancelledAtRaw);
      if (!cancelledAt) {
        return { kind: "invalid" };
      }
    }

    const experienceId = lookups.experiences.get(row.itemLabel);
    const classification = lookups.classifications.get(row.itemLabel);

    if (experienceId && classification) {
      return { kind: "conflict", itemLabel: row.itemLabel };
    }
    if (classification === FAREHARBOR_NON_EXPERIENCE_CLASSIFICATION) {
      return { kind: "non_experience" };
    }
    if (classification) {
      return { kind: "unknown", itemLabel: row.itemLabel };
    }
    if (!experienceId) {
      return { kind: "unknown", itemLabel: row.itemLabel };
    }

    return {
      kind: "mapped",
      row,
      experienceId,
      bookingPk: row.bookingPk,
      partySize,
      bookedAt,
      cancelledAt,
      startAt,
      sourceType: categorizeLastBookedBy(row.lastBookedBy),
      emailMarketingOptIn: parseYesNo(row.subscribedToEmail),
    };
  }

  private async applyMappedRow(
    db: FareharborDb,
    item: Extract<PreparedRow, { kind: "mapped" }>,
  ): Promise<void> {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`fh-booking-pk-${item.bookingPk}`}, 0))`,
    );

    const sessionId = await this.upsertReportSession(db, item);
    const bookingId = await this.upsertBooking(db, item, sessionId);
    await this.upsertContact(db, item, bookingId);
  }

  private async upsertReportSession(
    db: FareharborDb,
    item: Extract<PreparedRow, { kind: "mapped" }>,
  ): Promise<string> {
    const reportKey = fareharborAvailabilityReportKey(
      item.experienceId,
      item.startAt,
    );
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`fh-avail-report-${reportKey}`}, 0))`,
    );

    const existingBookingId = await findResolvedFareharborIdentity(
      db,
      FAREHARBOR_BOOKING_PK_ENTITY,
      item.bookingPk,
      INTERNAL_BOOKING,
    );
    const existingSessionFromBooking = existingBookingId
      ? await this.bookingSessionId(db, existingBookingId)
      : undefined;
    const existingSessionFromKey = await findResolvedFareharborIdentity(
      db,
      FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
      reportKey,
      INTERNAL_SESSION,
    );

    if (
      existingSessionFromBooking &&
      existingSessionFromKey &&
      existingSessionFromBooking !== existingSessionFromKey
    ) {
      throw new Error("fareharbor_session_identity_conflict");
    }

    const sessionId =
      existingSessionFromBooking ?? existingSessionFromKey;
    if (sessionId) {
      await db
        .update(sessions)
        .set({
          experienceId: item.experienceId,
          startAt: item.startAt,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));
      await upsertFareharborIdentity(
        db,
        FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
        reportKey,
        INTERNAL_SESSION,
        sessionId,
      );
      return sessionId;
    }

    const inserted = await db
      .insert(sessions)
      .values({
        experienceId: item.experienceId,
        startAt: item.startAt,
        endAt: null,
        capacity: null,
        status: null,
      })
      .returning({ id: sessions.id });
    const createdId = inserted[0]?.id;
    if (!createdId) {
      throw new Error("session_insert_failed");
    }

    await upsertFareharborIdentity(
      db,
      FAREHARBOR_AVAILABILITY_REPORT_KEY_ENTITY,
      reportKey,
      INTERNAL_SESSION,
      createdId,
    );
    return createdId;
  }

  private async bookingSessionId(
    db: FareharborDb,
    bookingId: string,
  ): Promise<string | undefined> {
    const rows = await db
      .select({ sessionId: bookings.sessionId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    return rows[0]?.sessionId ?? undefined;
  }

  private async upsertBooking(
    db: FareharborDb,
    item: Extract<PreparedRow, { kind: "mapped" }>,
    sessionId: string,
  ): Promise<string> {
    const existingId = await findResolvedFareharborIdentity(
      db,
      FAREHARBOR_BOOKING_PK_ENTITY,
      item.bookingPk,
      INTERNAL_BOOKING,
    );

    const values = {
      sessionId,
      experienceId: item.experienceId,
      status: item.row.cancelled ? "cancelled" : "booked",
      partySize: item.partySize,
      sourceType: item.sourceType,
      bookedAt: item.bookedAt,
      observedAt: new Date(),
      cancelledAt: item.cancelledAt ?? null,
      updatedAt: new Date(),
    };

    if (existingId) {
      await db.update(bookings).set(values).where(eq(bookings.id, existingId));
      await upsertFareharborIdentity(
        db,
        FAREHARBOR_BOOKING_PK_ENTITY,
        item.bookingPk,
        INTERNAL_BOOKING,
        existingId,
      );
      return existingId;
    }

    const inserted = await db
      .insert(bookings)
      .values(values)
      .returning({ id: bookings.id });
    const bookingId = inserted[0]?.id;
    if (!bookingId) {
      throw new Error("booking_insert_failed");
    }

    await upsertFareharborIdentity(
      db,
      FAREHARBOR_BOOKING_PK_ENTITY,
      item.bookingPk,
      INTERNAL_BOOKING,
      bookingId,
    );
    return bookingId;
  }

  private async upsertContact(
    db: FareharborDb,
    item: Extract<PreparedRow, { kind: "mapped" }>,
    bookingId: string,
  ): Promise<void> {
    const rows = await db
      .select({ id: bookingContacts.id })
      .from(bookingContacts)
      .where(eq(bookingContacts.bookingId, bookingId))
      .limit(1);

    const values = {
      name: optionalText(item.row.contactName),
      email: optionalText(item.row.email),
      phone: optionalText(item.row.phone),
      emailMarketingOptIn: item.emailMarketingOptIn ?? null,
      smsOptIn: null,
      observedAt: new Date(),
      updatedAt: new Date(),
    };

    if (rows[0]?.id) {
      await db
        .update(bookingContacts)
        .set(values)
        .where(eq(bookingContacts.id, rows[0].id));
      return;
    }

    await db.insert(bookingContacts).values({
      bookingId,
      ...values,
    });
  }
}

function emptySummary(
  outcome: "invalid_file",
  dryRun: boolean,
  reason: FareharborReportImportSummary["reason"],
): FareharborReportImportSummary {
  return {
    outcome,
    reason,
    dryRun,
    rows: 0,
    bookings: 0,
    cancelled: 0,
    totalPax: 0,
    mappedExperienceRows: 0,
    applied: 0,
    nonExperienceSkipped: 0,
    unknownItemLabels: [],
    unknownItemRows: 0,
    conflictingItemLabels: [],
    invalidRows: 0,
  };
}

export function categorizeLastBookedBy(value: string): string {
  return value.trim().toLowerCase() === "online" ? "online" : "internal";
}

function parseNonNegativeInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }
  return Number(value.trim());
}

function parseYesNo(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "true") {
    return true;
  }
  if (normalized === "no" || normalized === "false") {
    return false;
  }
  return undefined;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
