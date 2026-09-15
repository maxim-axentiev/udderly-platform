import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Injectable } from "@nestjs/common";
import type { AppDatabase } from "../../database/database.service";
import { bookings } from "../../database/schema/bookings";
import {
  experienceSourceMappings,
  experiences,
} from "../../database/schema/experiences";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { visits } from "../../database/schema/visits";
import {
  FAREHARBOR_BOOKING_ENTITY,
  FAREHARBOR_PROVIDER,
} from "../fareharbor/fareharbor.crypto";
import { FAREHARBOR_BOOKING_PK_ENTITY } from "../fareharbor/fareharbor.constants";
import {
  INTERNAL_BOOKING,
  INTERNAL_VISIT,
  WHEREWOLF_ACTIVITY_OBJECT_TYPE,
  WHEREWOLF_BOOKING_ALIAS_ENTITY,
  WHEREWOLF_GUEST_ENTITY,
  WHEREWOLF_GUEST_VISIT_ENTITY,
  WHEREWOLF_PROVIDER,
  WHEREWOLF_RESERVATION_ENTITY,
} from "./wherewolf.constants";
import {
  firstActivity,
  stringId,
  visitOccurrenceIdentity,
  type WherewolfVisitOccurrence,
} from "./wherewolf.occurrence";

type Db = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export type WherewolfNormalizeApplyResult =
  | {
      outcome: "applied";
      snapshotId: string;
      visitId: string;
      experienceName: string;
      bookingLinked: boolean;
      sessionLinked: boolean;
    }
  | { outcome: "skipped_stale"; snapshotId: string }
  | {
      outcome: "mapping_required";
      activityId?: string;
      activityName?: string;
    }
  | { outcome: "insufficient_identity"; snapshotId: string }
  | { outcome: "skipped"; reason: "not_guest" | "invalid_payload" };

@Injectable()
export class WherewolfNormalizer {
  async applySnapshot(
    db: Db,
    snapshotId: string,
  ): Promise<WherewolfNormalizeApplyResult> {
    const [snapshot] = await db
      .select()
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, snapshotId))
      .limit(1);

    if (!snapshot || snapshot.provider !== WHEREWOLF_PROVIDER) {
      return { outcome: "skipped", reason: "invalid_payload" };
    }

    if (snapshot.entityType !== WHEREWOLF_GUEST_ENTITY) {
      return { outcome: "skipped", reason: "not_guest" };
    }

    const payload = snapshot.payload;
    const guestId = stringId(payload.id);
    if (!guestId) {
      return { outcome: "skipped", reason: "invalid_payload" };
    }

    const reservation = await this.latestReservation(db, payload);
    const occurrence = visitOccurrenceIdentity(
      guestId,
      payload,
      reservation?.payload,
    );
    if (!occurrence) {
      return { outcome: "insufficient_identity", snapshotId };
    }

    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ww-guest-visit-${occurrence.key}`}, 0))`,
    );

    if (await this.hasNewerSameOccurrence(db, snapshot, guestId, occurrence.key)) {
      return { outcome: "skipped_stale", snapshotId };
    }

    const activity = firstActivity(payload);
    if (!activity) {
      return { outcome: "mapping_required" };
    }

    const mapping = await this.findActivityMapping(db, activity.id);
    if (!mapping) {
      return {
        outcome: "mapping_required",
        activityId: activity.id,
        activityName: activity.name,
      };
    }

    const experienceName = await this.experienceName(db, mapping.experienceId);
    const linkage = await this.resolveBooking(db, payload);
    const sessionId = linkage.bookingId
      ? await this.sessionFromBooking(db, linkage.bookingId)
      : undefined;

    const visitId = await this.upsertVisit(db, {
      occurrence,
      experienceId: mapping.experienceId,
      sessionId,
      bookingId: linkage.bookingId,
      matchConfidence: linkage.confidence,
      payload,
    });

    await this.upsertIdentity(
      db,
      WHEREWOLF_GUEST_VISIT_ENTITY,
      occurrence.key,
      INTERNAL_VISIT,
      visitId,
    );
    await this.upsertReservationIdentities(db, payload, linkage.bookingId);

    if (activity.name && activity.name !== mapping.externalLabel) {
      await db
        .update(experienceSourceMappings)
        .set({
          externalLabel: activity.name,
          updatedAt: new Date(),
        })
        .where(eq(experienceSourceMappings.id, mapping.id));
    }

    return {
      outcome: "applied",
      snapshotId,
      visitId,
      experienceName,
      bookingLinked: Boolean(linkage.bookingId),
      sessionLinked: Boolean(sessionId),
    };
  }

  private async findActivityMapping(
    db: Db,
    activityId: string,
  ): Promise<
    | { id: string; experienceId: string; externalLabel: string | null }
    | undefined
  > {
    const rows = await db
      .select({
        id: experienceSourceMappings.id,
        experienceId: experienceSourceMappings.experienceId,
        externalLabel: experienceSourceMappings.externalLabel,
      })
      .from(experienceSourceMappings)
      .where(
        and(
          eq(experienceSourceMappings.provider, WHEREWOLF_PROVIDER),
          eq(
            experienceSourceMappings.providerObjectType,
            WHEREWOLF_ACTIVITY_OBJECT_TYPE,
          ),
          eq(experienceSourceMappings.externalId, activityId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async latestReservation(
    db: Db,
    guest: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown>; observedAt: Date } | undefined> {
    const reservationId = stringId(guest.reservationsID);
    if (!reservationId) {
      return undefined;
    }
    const rows = await db
      .select({
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, WHEREWOLF_RESERVATION_ENTITY),
          eq(sourceSnapshots.externalId, reservationId),
        ),
      )
      .orderBy(desc(sourceSnapshots.observedAt))
      .limit(1);
    return rows[0];
  }

  private async hasNewerSameOccurrence(
    db: Db,
    snapshot: { observedAt: Date },
    guestId: string,
    occurrenceKey: string,
  ): Promise<boolean> {
    const newer = await db
      .select({
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, WHEREWOLF_GUEST_ENTITY),
          eq(sourceSnapshots.externalId, guestId),
          gt(sourceSnapshots.observedAt, snapshot.observedAt),
        ),
      );

    for (const row of newer) {
      const reservation = await this.latestReservation(db, row.payload);
      const occurrence = visitOccurrenceIdentity(
        guestId,
        row.payload,
        reservation?.payload,
      );
      if (occurrence?.key === occurrenceKey) {
        return true;
      }
    }
    return false;
  }

  private async experienceName(db: Db, experienceId: string): Promise<string> {
    const [row] = await db
      .select({ name: experiences.name })
      .from(experiences)
      .where(eq(experiences.id, experienceId))
      .limit(1);
    return row?.name ?? "unknown";
  }

  private async resolveBooking(
    db: Db,
    payload: Record<string, unknown>,
  ): Promise<{
    bookingId?: string;
    confidence: "linked" | "unmatched" | "ambiguous";
  }> {
    const candidates = bookingCandidates(payload);
    const bookingIds = new Set<string>();

    for (const candidate of candidates) {
      const bookingId = await this.findFareharborBooking(db, candidate);
      if (bookingId) {
        bookingIds.add(bookingId);
      }
    }

    if (bookingIds.size === 1) {
      return {
        bookingId: [...bookingIds][0],
        confidence: "linked",
      };
    }
    if (bookingIds.size > 1) {
      return { confidence: "ambiguous" };
    }
    return { confidence: "unmatched" };
  }

  private async findFareharborBooking(
    db: Db,
    externalId: string,
  ): Promise<string | undefined> {
    const rows = await db
      .select({
        internalEntityType: sourceIdentities.internalEntityType,
        internalEntityId: sourceIdentities.internalEntityId,
        entityType: sourceIdentities.entityType,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          eq(sourceIdentities.externalId, externalId),
        ),
      );

    const matches = rows.filter(
      (row) =>
        row.internalEntityType === INTERNAL_BOOKING &&
        row.internalEntityId &&
        (row.entityType === FAREHARBOR_BOOKING_ENTITY ||
          row.entityType === FAREHARBOR_BOOKING_PK_ENTITY),
    );
    if (matches.length === 1) {
      return matches[0]?.internalEntityId ?? undefined;
    }
    return undefined;
  }

  private async sessionFromBooking(
    db: Db,
    bookingId: string,
  ): Promise<string | undefined> {
    const [row] = await db
      .select({ sessionId: bookings.sessionId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    return row?.sessionId ?? undefined;
  }

  private async upsertVisit(
    db: Db,
    input: {
      occurrence: WherewolfVisitOccurrence;
      experienceId: string;
      sessionId?: string;
      bookingId?: string;
      matchConfidence: "linked" | "unmatched" | "ambiguous";
      payload: Record<string, unknown>;
    },
  ): Promise<string> {
    const existingId = await this.findResolvedIdentity(
      db,
      WHEREWOLF_GUEST_VISIT_ENTITY,
      input.occurrence.key,
      INTERNAL_VISIT,
    );

    const values = {
      experienceId: input.experienceId,
      sessionId: input.sessionId ?? null,
      bookingId: input.bookingId ?? null,
      visitedAt: input.occurrence.visitedAt ?? null,
      status: stringId(input.payload.status) ?? null,
      signed:
        typeof input.payload.signed === "boolean"
          ? input.payload.signed
          : null,
      isMinor:
        typeof input.payload.minor === "boolean"
          ? input.payload.minor
          : null,
      ageAtVisit: null,
      ageBand:
        input.payload.minor === true
          ? "child"
          : input.payload.minor === false
            ? "adult"
            : null,
      city: stringId(input.payload.city) ?? null,
      postal: null,
      referralSource: stringId(input.payload.whereDidYouHearAboutUs) ?? null,
      groupType: stringId(input.payload.groupType) ?? null,
      groupSize:
        integerValue(input.payload.groupSize ?? input.payload.howManyPeople) ??
        null,
      isRepeatVisitor:
        typeof input.payload.repeatCustomer === "boolean"
          ? input.payload.repeatCustomer
          : null,
      marketingOptIn:
        typeof input.payload.marketing === "boolean"
          ? input.payload.marketing
          : null,
      matchConfidence: input.matchConfidence,
      updatedAt: new Date(),
    };

    if (existingId) {
      await db.update(visits).set(values).where(eq(visits.id, existingId));
      return existingId;
    }

    const inserted = await db
      .insert(visits)
      .values(values)
      .returning({ id: visits.id });
    const visitId = inserted[0]?.id;
    if (!visitId) {
      throw new Error("visit_insert_failed");
    }
    return visitId;
  }

  private async upsertReservationIdentities(
    db: Db,
    payload: Record<string, unknown>,
    bookingId: string | undefined,
  ): Promise<void> {
    const reservationId = stringId(payload.reservationsID);
    if (reservationId) {
      await this.upsertIdentity(
        db,
        WHEREWOLF_RESERVATION_ENTITY,
        reservationId,
        bookingId ? INTERNAL_BOOKING : undefined,
        bookingId,
      );
    }

    for (const alias of aliasValues(payload)) {
      if (alias === reservationId) {
        continue;
      }
      await this.upsertIdentity(
        db,
        WHEREWOLF_BOOKING_ALIAS_ENTITY,
        alias,
        bookingId ? INTERNAL_BOOKING : undefined,
        bookingId,
      );
    }
  }

  private async findResolvedIdentity(
    db: Db,
    entityType: string,
    externalId: string,
    internalEntityType: string,
  ): Promise<string | undefined> {
    const rows = await db
      .select({
        internalEntityId: sourceIdentities.internalEntityId,
        internalEntityType: sourceIdentities.internalEntityType,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, WHEREWOLF_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row?.internalEntityType === internalEntityType && row.internalEntityId) {
      return row.internalEntityId;
    }
    return undefined;
  }

  private async upsertIdentity(
    db: Db,
    entityType: string,
    externalId: string,
    internalEntityType?: string,
    internalEntityId?: string,
  ): Promise<string> {
    const rows = await db
      .select({ id: sourceIdentities.id })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, WHEREWOLF_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);

    const existingId = rows[0]?.id;
    if (existingId) {
      if (internalEntityType && internalEntityId) {
        await db
          .update(sourceIdentities)
          .set({
            internalEntityType,
            internalEntityId,
            updatedAt: new Date(),
          })
          .where(eq(sourceIdentities.id, existingId));
      }
      return existingId;
    }

    const inserted = await db
      .insert(sourceIdentities)
      .values({
        provider: WHEREWOLF_PROVIDER,
        entityType,
        externalId,
        internalEntityType,
        internalEntityId,
      })
      .returning({ id: sourceIdentities.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error("source_identity_insert_failed");
    }
    return id;
  }
}

function bookingCandidates(payload: Record<string, unknown>): string[] {
  const values = new Set<string>();
  addCandidate(values, payload.bookingLabel);
  addCandidate(values, payload.displayId);
  for (const alias of aliasValues(payload)) {
    values.add(alias);
  }
  return [...values];
}

function aliasValues(payload: Record<string, unknown>): string[] {
  const aliases = payload.aliases;
  if (!Array.isArray(aliases)) {
    const single = stringId(aliases);
    return single ? [single] : [];
  }
  return aliases
    .map((entry) => stringId(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function addCandidate(set: Set<string>, value: unknown): void {
  const id = stringId(value);
  if (id) {
    set.add(id);
  }
}

function integerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return undefined;
}
