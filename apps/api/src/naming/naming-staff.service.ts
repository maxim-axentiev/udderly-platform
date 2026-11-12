import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { integrationEvents } from "../database/schema/integration-events";
import {
  namingNameRevisions,
  namingObjects,
  namingReservations,
} from "../database/schema/naming";
import { FAREHARBOR_PROVIDER } from "../integrations/fareharbor/fareharbor.crypto";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";
import { normalizeSubmittedName } from "./naming-link";
import {
  extractStaffBooking,
  presentStaffNaming,
  type StaffBookingDetails,
  type StaffNamingView,
  type StaffReservationFacts,
} from "./naming-staff-booking";
import { NAMING_CLOCK } from "./naming.constants";

export const CERTIFICATE_RESEND_CONFIRMATION = "RESEND-CERTIFICATE";

export type NamingStaffView = {
  objectId: string;
  objectName: string;
  priceCents: number;
  submittedName: string | null;
  namedAt: string | null;
  resendStatus: "sending" | "sent" | "failed" | null;
  resendCount: number;
  revisions: Array<{
    previousName: string;
    correctedName: string;
    createdAt: string;
  }>;
};

export type NamingCorrectionResult =
  | { outcome: "corrected"; submittedName: string }
  | { outcome: "unchanged"; submittedName: string }
  | { outcome: "invalid_name" }
  | { outcome: "not_found" };

@Injectable()
export class NamingStaffService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NamingLinkDeliveryService)
    private readonly delivery: NamingLinkDeliveryService,
    @Inject(NAMING_CLOCK) private readonly clock: () => Date,
  ) {}

  async claimsFor(
    objects: ReadonlyArray<{ id: string; status: string }>,
  ): Promise<Map<string, StaffNamingView>> {
    const ids = objects.map((object) => object.id);
    const reservations = ids.length === 0 ? [] : await this.reservationsFor(ids);
    const byObject = new Map<string, ReservationFacts[]>();
    for (const reservation of reservations) {
      const group = byObject.get(reservation.objectId) ?? [];
      group.push(reservation);
      byObject.set(reservation.objectId, group);
    }
    const selected = new Map<string, ReservationFacts | "ambiguous" | null>();
    for (const object of objects) {
      selected.set(object.id, selectReservation(object.status, byObject.get(object.id) ?? []));
    }
    const bookings = await this.bookingsFor(
      [...selected.values()].flatMap((reservation) =>
        reservation && reservation !== "ambiguous" && reservation.fareharborBookingUuid
          ? [reservation.fareharborBookingUuid]
          : [],
      ),
    );
    const views = new Map<string, StaffNamingView>();
    for (const object of objects) {
      const reservation = selected.get(object.id) ?? null;
      const ambiguous = reservation === "ambiguous";
      const facts = ambiguous || !reservation ? null : reservation;
      views.set(
        object.id,
        presentStaffNaming({
          objectStatus: object.status,
          reservation: facts,
          booking: facts?.fareharborBookingUuid
            ? bookings.get(facts.fareharborBookingUuid) ?? null
            : null,
          ambiguous,
        }),
      );
    }
    return views;
  }

  async view(objectId: string): Promise<NamingStaffView | undefined> {
    const [object] = await this.database.db
      .select({
        id: namingObjects.id,
        name: namingObjects.name,
        priceCents: namingObjects.priceAmount,
        claimedReservationId: namingObjects.claimedReservationId,
      })
      .from(namingObjects)
      .where(eq(namingObjects.id, objectId))
      .limit(1);
    if (!object?.claimedReservationId) {
      return undefined;
    }
    const [reservation] = await this.database.db
      .select({
        id: namingReservations.id,
        status: namingReservations.status,
        submittedName: namingReservations.submittedName,
        namedAt: namingReservations.namedAt,
        resendStatus: namingReservations.linkResendStatus,
        resendCount: namingReservations.linkResendCount,
      })
      .from(namingReservations)
      .where(eq(namingReservations.id, object.claimedReservationId))
      .limit(1);
    if (!reservation || reservation.status !== "claimed") {
      return undefined;
    }
    const revisions = await this.database.db
      .select({
        previousName: namingNameRevisions.previousName,
        correctedName: namingNameRevisions.correctedName,
        createdAt: namingNameRevisions.createdAt,
      })
      .from(namingNameRevisions)
      .where(eq(namingNameRevisions.reservationId, reservation.id))
      .orderBy(asc(namingNameRevisions.createdAt));
    return {
      objectId: object.id,
      objectName: object.name,
      priceCents: object.priceCents,
      submittedName: reservation.submittedName,
      namedAt: reservation.namedAt?.toISOString() ?? null,
      resendStatus: reservation.resendStatus,
      resendCount: reservation.resendCount,
      revisions: revisions.map((revision) => ({
        previousName: revision.previousName,
        correctedName: revision.correctedName,
        createdAt: revision.createdAt.toISOString(),
      })),
    };
  }

  async correct(objectId: string, rawName: string): Promise<NamingCorrectionResult> {
    const name = normalizeSubmittedName(rawName);
    if (!name) {
      return { outcome: "invalid_name" };
    }
    const now = this.clock();
    return this.database.db.transaction(async (tx) => {
      const [object] = await tx
        .select()
        .from(namingObjects)
        .where(eq(namingObjects.id, objectId))
        .limit(1)
        .for("update");
      if (!object?.claimedReservationId) {
        return { outcome: "not_found" };
      }
      const [reservation] = await tx
        .select()
        .from(namingReservations)
        .where(eq(namingReservations.id, object.claimedReservationId))
        .limit(1)
        .for("update");
      if (
        !reservation ||
        reservation.status !== "claimed" ||
        !reservation.submittedName ||
        !reservation.namedAt
      ) {
        return { outcome: "not_found" };
      }
      if (reservation.submittedName === name) {
        return { outcome: "unchanged", submittedName: name };
      }
      const previousName = reservation.submittedName;
      const [updated] = await tx
        .update(namingReservations)
        .set({ submittedName: name, updatedAt: now })
        .where(eq(namingReservations.id, reservation.id))
        .returning({ id: namingReservations.id });
      if (!updated) {
        return { outcome: "not_found" };
      }
      await tx.insert(namingNameRevisions).values({
        reservationId: reservation.id,
        objectId: object.id,
        previousName,
        correctedName: name,
      });
      return { outcome: "corrected", submittedName: name };
    });
  }

  resend(objectId: string) {
    return this.database.db.transaction(async (tx) => {
      const [object] = await tx
        .select({ claimedReservationId: namingObjects.claimedReservationId })
        .from(namingObjects)
        .where(eq(namingObjects.id, objectId))
        .limit(1);
      return object?.claimedReservationId;
    }).then((reservationId) => {
      if (!reservationId) {
        return { outcome: "not_found" as const };
      }
      return this.delivery.resendCertificate(reservationId);
    });
  }

  private async reservationsFor(objectIds: string[]): Promise<ReservationFacts[]> {
    return this.database.db
      .select({
        id: namingReservations.id,
        objectId: namingReservations.objectId,
        status: namingReservations.status,
        reviewReason: namingReservations.reviewReason,
        submittedName: namingReservations.submittedName,
        paidAmount: namingReservations.paidAmount,
        currency: namingReservations.currency,
        claimedAt: namingReservations.claimedAt,
        releasedAt: namingReservations.releasedAt,
        fareharborBookingUuid: namingReservations.fareharborBookingUuid,
      })
      .from(namingReservations)
      .where(inArray(namingReservations.objectId, objectIds));
  }

  private async bookingsFor(bookingUuids: string[]): Promise<Map<string, StaffBookingDetails>> {
    const unique = [...new Set(bookingUuids)];
    const bookings = new Map<string, StaffBookingDetails>();
    if (unique.length === 0) {
      return bookings;
    }
    const events = await this.database.db
      .select({
        externalEntityId: integrationEvents.externalEntityId,
        payload: integrationEvents.payload,
        receivedAt: integrationEvents.receivedAt,
        processingStatus: integrationEvents.processingStatus,
      })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          isNull(integrationEvents.duplicateOf),
          inArray(integrationEvents.externalEntityId, unique),
        ),
      );
    const grouped = new Map<string, typeof events>();
    for (const event of events) {
      if (!event.externalEntityId) {
        continue;
      }
      const group = grouped.get(event.externalEntityId) ?? [];
      group.push(event);
      grouped.set(event.externalEntityId, group);
    }
    for (const [uuid, group] of grouped) {
      const completed = group.filter((event) => event.processingStatus === "completed");
      const candidates = completed.length > 0 ? completed : group;
      candidates.sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime());
      const details = extractStaffBooking(candidates[0]?.payload);
      if (details) {
        bookings.set(uuid, details);
      }
    }
    return bookings;
  }
}

type ReservationFacts = StaffReservationFacts & {
  id: string;
  objectId: string;
  releasedAt: Date | null;
  fareharborBookingUuid: string | null;
};

function selectReservation(
  objectStatus: string,
  reservations: ReservationFacts[],
): ReservationFacts | "ambiguous" | null {
  if (objectStatus === "claimed") {
    const claimed = reservations.filter((reservation) => reservation.status === "claimed");
    if (claimed.length === 1) {
      return claimed[0] ?? null;
    }
    return claimed.length > 1 ? "ambiguous" : null;
  }
  if (objectStatus === "held") {
    const holding = reservations.filter(
      (reservation) =>
        reservation.status === "held" ||
        (reservation.status === "needs_review" && reservation.releasedAt === null),
    );
    if (holding.length === 1) {
      return holding[0] ?? null;
    }
    return holding.length > 1 ? "ambiguous" : null;
  }
  return null;
}
