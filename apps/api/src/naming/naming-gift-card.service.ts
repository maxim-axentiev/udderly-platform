import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  namingObjects,
  namingReservations,
  type NamingReviewReason,
} from "../database/schema/naming";
import { qualifiesForPurchaseDeadline } from "./naming-deadline";
import { readFareharborGiftCard } from "./naming-gift-card";
import { NAMING_CLOCK } from "./naming.constants";

type NamingObjectRow = typeof namingObjects.$inferSelect;
type NamingReservationRow = typeof namingReservations.$inferSelect;
type NamingTx = Parameters<DatabaseService["db"]["transaction"]>[0] extends (
  tx: infer Tx,
) => unknown
  ? Tx
  : never;

export type NamingGiftCardMatchResult =
  | { outcome: "claimed"; reservationId: string; objectId: string }
  | { outcome: "duplicate"; reservationId: string }
  | { outcome: "payment_reversed"; reservationId: string }
  | { outcome: "underpaid"; reservationId: string }
  | { outcome: "purchase_after_deadline"; reservationId: string }
  | {
      outcome: "needs_review";
      reservationId: string;
      reason: NamingReviewReason;
    }
  | {
      outcome: "ignored";
      reason:
        | "malformed"
        | "no_reference"
        | "unmatched_reference"
        | "wrong_item"
        | "invalid_payment"
        | "not_booked";
    };

/**
 * Matches one stored FareHarbor gift-card payload to a naming reservation.
 * A released hold is not proof the checkout expired. Claim does not create a
 * naming token. The purchaser and the webhook body are not copied.
 */
@Injectable()
export class NamingGiftCardService {
  private readonly logger = new Logger(NamingGiftCardService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NAMING_CLOCK) private readonly clock: () => Date,
  ) {}

  async match(payload: unknown): Promise<NamingGiftCardMatchResult> {
    const reading = readFareharborGiftCard(payload);
    if (reading.kind === "malformed" || reading.kind === "no_reference") {
      this.logger.warn(`naming_gift_card_${reading.kind}`);
      return { outcome: "ignored", reason: reading.kind };
    }
    if (reading.kind === "ignored") {
      this.logger.warn(`naming_gift_card_${reading.reason}`);
      return { outcome: "ignored", reason: reading.reason };
    }

    try {
      return await this.apply(reading);
    } catch (error) {
      if (!isBookingUuidConflict(error)) {
        throw error;
      }
      return await this.apply(reading);
    }
  }

  private async apply(
    reading: Extract<
      ReturnType<typeof readFareharborGiftCard>,
      { kind: "payable" | "refunded" }
    >,
  ): Promise<NamingGiftCardMatchResult> {
    const now = this.clock();
    return this.database.db.transaction(async (tx) => {
      const [found] = await tx
        .select({
          id: namingReservations.id,
          objectId: namingReservations.objectId,
        })
        .from(namingReservations)
        .where(eq(namingReservations.checkoutRef, reading.checkoutRef))
        .limit(1);
      if (!found) {
        this.logger.warn("naming_gift_card_unmatched_reference");
        return { outcome: "ignored", reason: "unmatched_reference" };
      }

      const object = await lockObject(tx, found.objectId);
      const reservation = await lockReservation(tx, found.id);
      if (!object || !reservation) {
        return { outcome: "ignored", reason: "unmatched_reference" };
      }

      if (reading.kind === "refunded") {
        return this.applyRefund(tx, object, reservation, reading, now);
      }
      return this.applyPayment(tx, object, reservation, reading, now);
    });
  }

  private async applyRefund(
    tx: NamingTx,
    object: NamingObjectRow,
    reservation: NamingReservationRow,
    reading: { bookingUuid: string; paidAmount: number | null },
    now: Date,
  ): Promise<NamingGiftCardMatchResult> {
    if (
      reservation.status === "claimed" &&
      reservation.fareharborBookingUuid === reading.bookingUuid
    ) {
      if (
        reservation.reviewReason !== null &&
        reservation.reviewReason !== "payment_reversed"
      ) {
        return { outcome: "duplicate", reservationId: reservation.id };
      }
      await tx
        .update(namingReservations)
        .set({ reviewReason: "payment_reversed", updatedAt: now })
        .where(eq(namingReservations.id, reservation.id));
      return { outcome: "payment_reversed", reservationId: reservation.id };
    }

    if (reservation.status === "claimed") {
      await flagClaimedDuplicate(tx, reservation, now);
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "duplicate_booking",
      };
    }

    if (reservation.status === "needs_review") {
      if (
        reservation.fareharborBookingUuid &&
        reservation.fareharborBookingUuid !== reading.bookingUuid
      ) {
        await flagExistingDuplicate(tx, reservation, now);
        return {
          outcome: "needs_review",
          reservationId: reservation.id,
          reason: "duplicate_booking",
        };
      }
      if (!reservation.fareharborBookingUuid) {
        const owner = await bookingOwner(tx, reading.bookingUuid);
        if (owner && owner.id !== reservation.id) {
          await flagExistingDuplicate(tx, reservation, now);
          return {
            outcome: "needs_review",
            reservationId: reservation.id,
            reason: "duplicate_booking",
          };
        }
      }
      if (reservation.reviewReason !== "payment_reversed") {
        await tx
          .update(namingReservations)
          .set({
            reviewReason: "payment_reversed",
            fareharborBookingUuid:
              reservation.fareharborBookingUuid ?? reading.bookingUuid,
            paidAmount: reservation.paidAmount ?? reading.paidAmount,
            updatedAt: now,
          })
          .where(eq(namingReservations.id, reservation.id));
      }
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "payment_reversed",
      };
    }

    const owner = await bookingOwner(tx, reading.bookingUuid);
    if (owner && owner.id !== reservation.id) {
      await markReview(tx, object, reservation, now, {
        reason: "duplicate_booking",
        bookingUuid: null,
        paidAmount: null,
      });
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "duplicate_booking",
      };
    }

    await markReview(tx, object, reservation, now, {
      reason: "payment_reversed",
      bookingUuid: reading.bookingUuid,
      paidAmount: reading.paidAmount,
    });
    return {
      outcome: "needs_review",
      reservationId: reservation.id,
      reason: "payment_reversed",
    };
  }

  private async applyPayment(
    tx: NamingTx,
    object: NamingObjectRow,
    reservation: NamingReservationRow,
    reading: { bookingUuid: string; paidAmount: number; paidAt: Date | null },
    now: Date,
  ): Promise<NamingGiftCardMatchResult> {
    if (reservation.status === "needs_review") {
      if (reservation.reviewReason === "underpaid") {
        return { outcome: "underpaid", reservationId: reservation.id };
      }
      if (reservation.reviewReason === "purchase_after_deadline") {
        return {
          outcome: "purchase_after_deadline",
          reservationId: reservation.id,
        };
      }
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: reservation.reviewReason ?? "amount_mismatch",
      };
    }

    if (reservation.status === "claimed") {
      if (reservation.fareharborBookingUuid === reading.bookingUuid) {
        return { outcome: "duplicate", reservationId: reservation.id };
      }
      await flagClaimedDuplicate(tx, reservation, now);
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "duplicate_booking",
      };
    }

    const owner = await bookingOwner(tx, reading.bookingUuid);
    if (owner && owner.id !== reservation.id) {
      await markReview(tx, object, reservation, now, {
        reason: "duplicate_booking",
        bookingUuid: null,
        paidAmount: null,
      });
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "duplicate_booking",
      };
    }

    if (reading.paidAmount < reservation.priceAmount) {
      await markReview(tx, object, reservation, now, {
        reason: "underpaid",
        bookingUuid: reading.bookingUuid,
        paidAmount: reading.paidAmount,
        releaseNow: true,
      });
      return { outcome: "underpaid", reservationId: reservation.id };
    }

    if (!reading.paidAt) {
      await markReview(tx, object, reservation, now, {
        reason: "payment_time_unverified",
        bookingUuid: reading.bookingUuid,
        paidAmount: reading.paidAmount,
      });
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "payment_time_unverified",
      };
    }

    if (!qualifiesForPurchaseDeadline(reading.paidAt)) {
      await markReview(tx, object, reservation, now, {
        reason: "purchase_after_deadline",
        bookingUuid: reading.bookingUuid,
        paidAmount: reading.paidAmount,
        releaseNow: true,
      });
      return {
        outcome: "purchase_after_deadline",
        reservationId: reservation.id,
      };
    }

    const holdsThis =
      object.status === "held" &&
      object.heldReservationId === reservation.id &&
      object.claimedReservationId === null;
    const available =
      object.status === "available" &&
      object.heldReservationId === null &&
      object.claimedReservationId === null;
    if (!holdsThis && !available) {
      await markReview(tx, object, reservation, now, {
        reason: "late_conflict",
        bookingUuid: reading.bookingUuid,
        paidAmount: reading.paidAmount,
      });
      return {
        outcome: "needs_review",
        reservationId: reservation.id,
        reason: "late_conflict",
      };
    }

    const [claimed] = await tx
      .update(namingReservations)
      .set({
        status: "claimed",
        claimedAt: now,
        releasedAt: null,
        fareharborBookingUuid: reading.bookingUuid,
        paidAmount: reading.paidAmount,
        reviewReason: null,
        adminResolutionRequired: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(namingReservations.id, reservation.id),
          or(
            eq(namingReservations.status, "held"),
            eq(namingReservations.status, "released"),
          ),
          or(
            isNull(namingReservations.fareharborBookingUuid),
            eq(namingReservations.fareharborBookingUuid, reading.bookingUuid),
          ),
        ),
      )
      .returning({ id: namingReservations.id });
    if (!claimed) {
      return { outcome: "duplicate", reservationId: reservation.id };
    }

    const [objectClaim] = await tx
      .update(namingObjects)
      .set({
        status: "claimed",
        heldReservationId: null,
        claimedReservationId: reservation.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(namingObjects.id, object.id),
          or(
            and(
              eq(namingObjects.status, "held"),
              eq(namingObjects.heldReservationId, reservation.id),
            ),
            and(
              eq(namingObjects.status, "available"),
              isNull(namingObjects.heldReservationId),
              isNull(namingObjects.claimedReservationId),
            ),
          ),
        ),
      )
      .returning({ id: namingObjects.id });
    if (!objectClaim) {
      throw new Error("naming_gift_card_claim_lost_object");
    }

    return {
      outcome: "claimed",
      reservationId: reservation.id,
      objectId: object.id,
    };
  }
}

async function markReview(
  tx: NamingTx,
  object: NamingObjectRow,
  reservation: NamingReservationRow,
  now: Date,
  update: {
    reason: NamingReviewReason;
    bookingUuid: string | null;
    paidAmount: number | null;
    releaseNow?: boolean;
  },
): Promise<void> {
  const holdsObject =
    object.status === "held" &&
    object.heldReservationId === reservation.id &&
    object.claimedReservationId === null;
  const keepHold =
    !update.releaseNow &&
    holdsObject &&
    reservation.holdExpiresAt !== null &&
    reservation.holdExpiresAt.getTime() > now.getTime();

  await tx
    .update(namingReservations)
    .set({
      status: "needs_review",
      reviewReason: update.reason,
      fareharborBookingUuid: update.bookingUuid,
      paidAmount: update.paidAmount,
      releasedAt: keepHold ? null : (reservation.releasedAt ?? now),
      claimedAt: null,
      namingTokenHash: null,
      submittedName: null,
      namedAt: null,
      linkDeliveryStatus: null,
      linkDeliveryStartedAt: null,
      adminResolutionRequired: false,
      updatedAt: now,
    })
    .where(eq(namingReservations.id, reservation.id));

  if (!holdsObject || keepHold) {
    return;
  }

  const [freed] = await tx
    .update(namingObjects)
    .set({
      status: "available",
      heldReservationId: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(namingObjects.id, object.id),
        eq(namingObjects.status, "held"),
        eq(namingObjects.heldReservationId, reservation.id),
      ),
    )
    .returning({ id: namingObjects.id });
  if (!freed) {
    throw new Error("naming_gift_card_review_lost_holder");
  }
}

async function flagClaimedDuplicate(
  tx: NamingTx,
  reservation: NamingReservationRow,
  now: Date,
): Promise<void> {
  if (reservation.reviewReason !== null) {
    return;
  }
  await tx
    .update(namingReservations)
    .set({ reviewReason: "duplicate_booking", updatedAt: now })
    .where(
      and(
        eq(namingReservations.id, reservation.id),
        eq(namingReservations.status, "claimed"),
        isNull(namingReservations.reviewReason),
      ),
    );
}

async function flagExistingDuplicate(
  tx: NamingTx,
  reservation: NamingReservationRow,
  now: Date,
): Promise<void> {
  await tx
    .update(namingReservations)
    .set({ reviewReason: "duplicate_booking", updatedAt: now })
    .where(eq(namingReservations.id, reservation.id));
}

async function bookingOwner(
  tx: NamingTx,
  bookingUuid: string,
): Promise<{ id: string } | undefined> {
  const [owner] = await tx
    .select({ id: namingReservations.id })
    .from(namingReservations)
    .where(eq(namingReservations.fareharborBookingUuid, bookingUuid))
    .limit(1);
  return owner;
}

async function lockObject(
  tx: NamingTx,
  objectId: string,
): Promise<NamingObjectRow | undefined> {
  const [object] = await tx
    .select()
    .from(namingObjects)
    .where(eq(namingObjects.id, objectId))
    .limit(1)
    .for("update");
  return object;
}

async function lockReservation(
  tx: NamingTx,
  reservationId: string,
): Promise<NamingReservationRow | undefined> {
  const [reservation] = await tx
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reservationId))
    .limit(1)
    .for("update");
  return reservation;
}

function isBookingUuidConflict(error: unknown): boolean {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
    }
    const record = current as Record<string, unknown>;
    for (const key of ["code", "constraint", "constraint_name", "detail"]) {
      if (typeof record[key] === "string") {
        parts.push(record[key]);
      }
    }
    current = "cause" in record ? record.cause : undefined;
  }
  return parts.join(" ").includes("naming_reservation_booking_uuid_uidx");
}
