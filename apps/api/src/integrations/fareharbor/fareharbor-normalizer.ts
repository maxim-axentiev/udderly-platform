import { and, eq, sql } from "drizzle-orm";
import { Injectable } from "@nestjs/common";
import type { AppDatabase } from "../../database/database.service";
import {
  bookingContacts,
  bookingPartyMembers,
  bookings,
} from "../../database/schema/bookings";
import {
  experienceSourceMappings,
  sessions,
} from "../../database/schema/experiences";
import { sourceIdentities } from "../../database/schema/source-identity";
import {
  FAREHARBOR_BOOKING_ENTITY,
  FAREHARBOR_PROVIDER,
} from "./fareharbor.crypto";
import {
  FAREHARBOR_AVAILABILITY_ENTITY,
  FAREHARBOR_BOOKING_PK_ENTITY,
  FAREHARBOR_CUSTOMER_ENTITY,
  FAREHARBOR_ITEM_OBJECT_TYPE,
  INTERNAL_BOOKING,
  INTERNAL_SESSION,
} from "./fareharbor.constants";
import type { FareharborBookingSnapshot } from "./fareharbor.snapshot";

export type Db = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export type FareharborNormalizeApplyResult =
  | { outcome: "applied" }
  | {
      outcome: "mapping_required";
      itemPk?: string;
      itemName?: string;
    };

@Injectable()
export class FareharborNormalizer {
  async apply(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    observedAt: Date,
  ): Promise<FareharborNormalizeApplyResult> {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${snapshot.uuid}, 0))`,
    );

    const mapping = await this.requireExperienceMapping(db, snapshot);
    if (mapping.outcome === "mapping_required") {
      return mapping;
    }

    const sessionId = await this.upsertSession(
      db,
      snapshot,
      mapping.experienceId,
    );
    const bookingId = await this.upsertBooking(
      db,
      snapshot,
      mapping.experienceId,
      sessionId,
      observedAt,
    );
    await this.linkRebookings(db, snapshot, bookingId);
    await this.upsertContact(db, snapshot, bookingId, observedAt);
    await this.syncPartyMembers(db, snapshot, bookingId, observedAt);
    return { outcome: "applied" };
  }

  private async requireExperienceMapping(
    db: Db,
    snapshot: FareharborBookingSnapshot,
  ): Promise<
    | { outcome: "mapped"; experienceId: string }
    | {
        outcome: "mapping_required";
        itemPk?: string;
        itemName?: string;
      }
  > {
    const item = snapshot.availability?.item;
    if (!item) {
      return { outcome: "mapping_required" };
    }

    const existing = await this.findMapping(db, item.pk);
    if (!existing) {
      return {
        outcome: "mapping_required",
        itemPk: item.pk,
        itemName: item.name,
      };
    }

    if (item.name && item.name !== existing.externalLabel) {
      await db
        .update(experienceSourceMappings)
        .set({
          externalLabel: item.name,
          updatedAt: new Date(),
        })
        .where(eq(experienceSourceMappings.id, existing.id));
    }

    return { outcome: "mapped", experienceId: existing.experienceId };
  }

  private async findMapping(
    db: Db,
    itemPk: string,
  ): Promise<{ id: string; experienceId: string; externalLabel: string | null } | undefined> {
    const rows = await db
      .select({
        id: experienceSourceMappings.id,
        experienceId: experienceSourceMappings.experienceId,
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
          eq(experienceSourceMappings.externalId, itemPk),
        ),
      )
      .limit(1);

    return rows[0];
  }

  private async upsertSession(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    experienceId: string,
  ): Promise<string | undefined> {
    const availability = snapshot.availability;
    if (!availability?.startAt) {
      return undefined;
    }

    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`fh-avail-${availability.pk}`}, 0))`,
    );

    const existingId = await this.findResolvedIdentity(
      db,
      FAREHARBOR_AVAILABILITY_ENTITY,
      availability.pk,
      INTERNAL_SESSION,
    );

    if (existingId) {
      await db
        .update(sessions)
        .set({
          startAt: availability.startAt,
          endAt: availability.endAt,
          capacity: availability.capacity,
          status: availability.status,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, existingId));
      return existingId;
    }

    const inserted = await db
      .insert(sessions)
      .values({
        experienceId,
        startAt: availability.startAt,
        endAt: availability.endAt,
        capacity: availability.capacity,
        status: availability.status,
      })
      .returning({ id: sessions.id });
    const sessionId = inserted[0]?.id;
    if (!sessionId) {
      throw new Error("session_insert_failed");
    }

    await this.upsertIdentity(
      db,
      FAREHARBOR_AVAILABILITY_ENTITY,
      availability.pk,
      INTERNAL_SESSION,
      sessionId,
    );

    return sessionId;
  }

  private async upsertBooking(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    experienceId: string,
    sessionId: string | undefined,
    observedAt: Date,
  ): Promise<string> {
    const existingId = await this.findResolvedIdentity(
      db,
      FAREHARBOR_BOOKING_ENTITY,
      snapshot.uuid,
      INTERNAL_BOOKING,
    );

    const values = {
      sessionId,
      experienceId,
      status: snapshot.status,
      partySize: snapshot.partySize,
      sourceType: snapshot.sourceType,
      bookedAt: snapshot.bookedAt,
      observedAt,
      cancelledAt: snapshot.cancelledAt,
      isSuperseded: snapshot.isSuperseded,
      updatedAt: new Date(),
    };

    if (existingId) {
      await db.update(bookings).set(values).where(eq(bookings.id, existingId));
      await this.upsertBookingIdentities(db, snapshot, existingId);
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

    await this.upsertBookingIdentities(db, snapshot, bookingId);
    return bookingId;
  }

  private async upsertBookingIdentities(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    bookingId: string,
  ): Promise<void> {
    await this.upsertIdentity(
      db,
      FAREHARBOR_BOOKING_ENTITY,
      snapshot.uuid,
      INTERNAL_BOOKING,
      bookingId,
    );

    if (snapshot.pk) {
      await this.upsertIdentity(
        db,
        FAREHARBOR_BOOKING_PK_ENTITY,
        snapshot.pk,
        INTERNAL_BOOKING,
        bookingId,
      );
    }
  }

  private async linkRebookings(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    bookingId: string,
  ): Promise<void> {
    const fromId = snapshot.rebookedFromUuid
      ? await this.findResolvedIdentity(
          db,
          FAREHARBOR_BOOKING_ENTITY,
          snapshot.rebookedFromUuid,
          INTERNAL_BOOKING,
        )
      : undefined;
    const toId = snapshot.rebookedToUuid
      ? await this.findResolvedIdentity(
          db,
          FAREHARBOR_BOOKING_ENTITY,
          snapshot.rebookedToUuid,
          INTERNAL_BOOKING,
        )
      : undefined;

    await db
      .update(bookings)
      .set({
        rebookedFromBookingId: fromId,
        rebookedToBookingId: toId,
        isSuperseded: snapshot.isSuperseded,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    if (fromId) {
      await db
        .update(bookings)
        .set({
          rebookedToBookingId: bookingId,
          isSuperseded: true,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, fromId));
    }

    if (toId) {
      await db
        .update(bookings)
        .set({
          rebookedFromBookingId: bookingId,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, toId));
    }
  }

  private async upsertContact(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    bookingId: string,
    observedAt: Date,
  ): Promise<void> {
    const contact = snapshot.contact;
    const rows = await db
      .select({ id: bookingContacts.id })
      .from(bookingContacts)
      .where(eq(bookingContacts.bookingId, bookingId))
      .limit(1);

    const values = {
      name: contact?.name,
      email: contact?.email,
      phone: contact?.phone,
      emailMarketingOptIn: contact?.emailMarketingOptIn,
      smsOptIn: contact?.smsOptIn,
      observedAt,
      updatedAt: new Date(),
    };

    const existingId = rows[0]?.id;
    if (existingId) {
      await db
        .update(bookingContacts)
        .set(values)
        .where(eq(bookingContacts.id, existingId));
      return;
    }

    await db.insert(bookingContacts).values({
      bookingId,
      ...values,
    });
  }

  private async syncPartyMembers(
    db: Db,
    snapshot: FareharborBookingSnapshot,
    bookingId: string,
    observedAt: Date,
  ): Promise<void> {
    const seenIdentityIds = new Set<string>();

    for (const customer of snapshot.customers) {
      const identityId = await this.upsertIdentity(
        db,
        FAREHARBOR_CUSTOMER_ENTITY,
        customer.pk,
      );
      seenIdentityIds.add(identityId);

      const existing = await db
        .select({ id: bookingPartyMembers.id })
        .from(bookingPartyMembers)
        .where(
          and(
            eq(bookingPartyMembers.bookingId, bookingId),
            eq(bookingPartyMembers.sourceIdentityId, identityId),
          ),
        )
        .limit(1);

      const values = {
        customerType: customer.customerType,
        checkinStatus: customer.checkinStatus,
        sequence: customer.sequence,
        isActive: true,
        lastSeenAt: observedAt,
        removedAt: null,
        updatedAt: new Date(),
      };

      const existingId = existing[0]?.id;
      if (existingId) {
        await db
          .update(bookingPartyMembers)
          .set(values)
          .where(eq(bookingPartyMembers.id, existingId));
        continue;
      }

      await db.insert(bookingPartyMembers).values({
        bookingId,
        sourceIdentityId: identityId,
        ...values,
      });
    }

    const members = await db
      .select({
        id: bookingPartyMembers.id,
        sourceIdentityId: bookingPartyMembers.sourceIdentityId,
        isActive: bookingPartyMembers.isActive,
      })
      .from(bookingPartyMembers)
      .where(eq(bookingPartyMembers.bookingId, bookingId));

    for (const member of members) {
      if (
        member.sourceIdentityId &&
        seenIdentityIds.has(member.sourceIdentityId)
      ) {
        continue;
      }
      if (!member.isActive) {
        continue;
      }

      await db
        .update(bookingPartyMembers)
        .set({
          isActive: false,
          removedAt: observedAt,
          updatedAt: new Date(),
        })
        .where(eq(bookingPartyMembers.id, member.id));
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
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (
      row?.internalEntityType === internalEntityType &&
      row.internalEntityId
    ) {
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
          eq(sourceIdentities.provider, FAREHARBOR_PROVIDER),
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
        provider: FAREHARBOR_PROVIDER,
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
