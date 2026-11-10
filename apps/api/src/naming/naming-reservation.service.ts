import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  namingObjects,
  namingReservations,
} from "../database/schema/naming";
import { NAMING_HOLD_QUEUE } from "../queue/queue.constants";
import { createCheckoutRef } from "./naming-checkout-ref";
import { qualifiesForPurchaseDeadline } from "./naming-deadline";
import {
  fareharborGiftCardCheckoutUrl,
  NAMING_CLOCK,
  NAMING_HOLD_MS,
} from "./naming.constants";

type NamingObjectRow = typeof namingObjects.$inferSelect;
type NamingReservationRow = typeof namingReservations.$inferSelect;
type NamingTx = Parameters<DatabaseService["db"]["transaction"]>[0] extends (
  tx: infer Tx,
) => unknown
  ? Tx
  : never;

export type NamingReserveResult =
  | {
      outcome: "reserved";
      reservationId: string;
      holdExpiresAt: Date;
      checkoutUrl: string;
    }
  | { outcome: "not_found" }
  | { outcome: "unpublished" }
  | { outcome: "unavailable" }
  | { outcome: "purchase_closed" };

export type NamingReleaseResult = { outcome: "released" | "unchanged" };

/**
 * Holds a published naming object for 30 minutes. Releasing a hold does not
 * cancel the FareHarbor checkout and does not claim the object. A late
 * payment has to be matched later without taking a newer hold or claim.
 */
@Injectable()
export class NamingReservationService {
  private readonly logger = new Logger(NamingReservationService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @InjectQueue(NAMING_HOLD_QUEUE) private readonly queue: Queue,
    @Inject(NAMING_CLOCK) private readonly clock: () => Date,
  ) {}

  async reserve(objectId: string): Promise<NamingReserveResult> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const checkoutRef = createCheckoutRef();
      try {
        const result = await this.reserveOnce(objectId, checkoutRef);
        if (result.outcome === "reserved") {
          await this.scheduleRelease(result.reservationId, result.holdExpiresAt);
        }
        return result;
      } catch (error) {
        if (isHoldConflict(error)) {
          return { outcome: "unavailable" };
        }
        if (isCheckoutRefConflict(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("naming_checkout_ref_exhausted");
  }

  async releaseExpiredHold(reservationId: string): Promise<NamingReleaseResult> {
    const now = this.clock();
    return this.database.db.transaction(async (tx) => {
      const [peek] = await tx
        .select({ objectId: namingReservations.objectId })
        .from(namingReservations)
        .where(eq(namingReservations.id, reservationId))
        .limit(1);
      if (!peek) {
        return { outcome: "unchanged" };
      }

      const object = await lockObject(tx, peek.objectId);
      const reservation = await lockReservation(tx, reservationId);
      if (!object || !reservation) {
        return { outcome: "unchanged" };
      }
      const released = await releaseIfCurrentHolder(tx, object, reservation, now);
      return { outcome: released ? "released" : "unchanged" };
    });
  }

  private async reserveOnce(
    objectId: string,
    checkoutRef: string,
  ): Promise<NamingReserveResult> {
    const now = this.clock();
    return this.database.db.transaction(async (tx) => {
      if (!qualifiesForPurchaseDeadline(now)) {
        return { outcome: "purchase_closed" };
      }

      let object = await lockObject(tx, objectId);
      if (!object) {
        return { outcome: "not_found" };
      }

      object = await expireCurrentHoldIfDue(tx, object, now);
      if (!object.publishedAt) {
        return { outcome: "unpublished" };
      }
      if (
        object.status !== "available" ||
        object.heldReservationId ||
        object.claimedReservationId
      ) {
        return { outcome: "unavailable" };
      }

      const holdExpiresAt = new Date(now.getTime() + NAMING_HOLD_MS);
      const [reservation] = await tx
        .insert(namingReservations)
        .values({
          objectId: object.id,
          checkoutRef,
          priceAmount: object.priceAmount,
          currency: "CAD",
          status: "held",
          holdExpiresAt,
          adminResolutionRequired: false,
        })
        .returning();
      const [held] = await tx
        .update(namingObjects)
        .set({
          status: "held",
          heldReservationId: reservation.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(namingObjects.id, object.id),
            eq(namingObjects.status, "available"),
            isNull(namingObjects.heldReservationId),
          ),
        )
        .returning({ id: namingObjects.id });
      if (!held) {
        throw new Error("naming_object_hold_lost");
      }

      return {
        outcome: "reserved",
        reservationId: reservation.id,
        holdExpiresAt,
        checkoutUrl: fareharborGiftCardCheckoutUrl(checkoutRef),
      };
    });
  }

  private async scheduleRelease(
    reservationId: string,
    holdExpiresAt: Date,
  ): Promise<void> {
    try {
      await this.queue.add(
        "release-hold",
        { reservationId },
        {
          jobId: `naming-release-${reservationId}`,
          delay: Math.max(0, holdExpiresAt.getTime() - this.clock().getTime()),
          removeOnComplete: 100,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
        },
      );
    } catch {
      this.logger.warn(
        "Naming hold was saved, but the release job was not queued. A later reservation attempt can release it.",
      );
    }
  }
}

async function expireCurrentHoldIfDue(
  tx: NamingTx,
  object: NamingObjectRow,
  now: Date,
): Promise<NamingObjectRow> {
  if (object.status !== "held" || !object.heldReservationId) {
    return object;
  }
  const reservation = await lockReservation(tx, object.heldReservationId);
  if (!reservation) {
    return object;
  }
  const released = await releaseIfCurrentHolder(tx, object, reservation, now);
  if (!released) {
    return object;
  }
  return (await lockObject(tx, object.id)) ?? object;
}

async function releaseIfCurrentHolder(
  tx: NamingTx,
  object: NamingObjectRow,
  reservation: NamingReservationRow,
  now: Date,
): Promise<boolean> {
  if (
    object.status !== "held" ||
    object.heldReservationId !== reservation.id ||
    object.claimedReservationId
  ) {
    return false;
  }
  if (!holdIsExpired(reservation, now)) {
    return false;
  }

  if (reservation.status === "held") {
    const [updated] = await tx
      .update(namingReservations)
      .set({ status: "released", releasedAt: now, updatedAt: now })
      .where(
        and(
          eq(namingReservations.id, reservation.id),
          eq(namingReservations.status, "held"),
          isNull(namingReservations.releasedAt),
        ),
      )
      .returning({ id: namingReservations.id });
    if (!updated) {
      return false;
    }
  } else if (
    reservation.status === "needs_review" &&
    reservation.releasedAt === null
  ) {
    const [updated] = await tx
      .update(namingReservations)
      .set({ releasedAt: now, updatedAt: now })
      .where(
        and(
          eq(namingReservations.id, reservation.id),
          eq(namingReservations.status, "needs_review"),
          isNull(namingReservations.releasedAt),
          eq(namingReservations.adminResolutionRequired, false),
        ),
      )
      .returning({ id: namingReservations.id });
    if (!updated) {
      return false;
    }
  } else {
    return false;
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
    throw new Error("naming_hold_release_lost_holder");
  }
  return true;
}

function holdIsExpired(reservation: NamingReservationRow, now: Date): boolean {
  if (reservation.adminResolutionRequired) {
    return false;
  }
  if (reservation.status === "held") {
    return (
      reservation.holdExpiresAt !== null &&
      reservation.holdExpiresAt.getTime() <= now.getTime()
    );
  }
  if (reservation.status === "needs_review" && reservation.releasedAt === null) {
    return (
      reservation.holdExpiresAt !== null &&
      reservation.holdExpiresAt.getTime() <= now.getTime()
    );
  }
  return false;
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

function isCheckoutRefConflict(error: unknown): boolean {
  return errorText(error).includes("naming_reservation_checkout_ref_uidx");
}

function isHoldConflict(error: unknown): boolean {
  return errorText(error).includes("naming_reservation_object_held_uidx");
}

function errorText(error: unknown): string {
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
  return parts.join(" ");
}
