import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  defaultFareharborTierCheckouts,
  expectedFareharborItemId,
  type FareharborTierCheckout,
} from "@udderly/shared";
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { EnvService } from "../config/env.service";
import { DatabaseService } from "../database/database.service";
import { integrationEvents } from "../database/schema/integration-events";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { FAREHARBOR_PROVIDER } from "../integrations/fareharbor/fareharbor.crypto";
import { createNamingToken, readFareharborGiftCard } from "./naming-gift-card";
import {
  namingCertificateMessage,
  namingLinkMessage,
  namingLinkUrl,
  readNamingPurchaserAddress,
} from "./naming-link-delivery";
import { NamingMailer } from "./naming-mailer";
import {
  FAREHARBOR_TIER_CHECKOUTS,
  NAMING_CLOCK,
  NAMING_LINK_DELIVERY_STALE_MS,
} from "./naming.constants";

type NamingTx = Parameters<DatabaseService["db"]["transaction"]>[0] extends (
  tx: infer Tx,
) => unknown
  ? Tx
  : never;

export type NamingLinkDeliveryResult =
  | { outcome: "sent" }
  | { outcome: "already_sent" }
  | { outcome: "already_issued" }
  | { outcome: "already_named" }
  | { outcome: "in_progress" }
  | { outcome: "not_eligible" }
  | { outcome: "not_found" }
  | { outcome: "not_configured" }
  | { outcome: "smtp_failed" }
  | { outcome: "uncommitted" };

type PreparedDelivery =
  | Exclude<NamingLinkDeliveryResult, { outcome: "sent" | "smtp_failed" | "uncommitted" }>
  | { outcome: "locked"; address: string; objectName: string };

type PreparedResend =
  | Exclude<NamingLinkDeliveryResult, { outcome: "sent" | "smtp_failed" | "uncommitted" }>
  | {
      outcome: "locked";
      address: string;
      objectName: string;
      submittedName: string;
      previousHash: string;
    };

/**
 * Emails one naming link after a verified claim.
 *
 * The plaintext token exists only in this process. It is not written to
 * PostgreSQL, Redis, BullMQ, or logs. The hash is stored only after the
 * mail provider accepts the message.
 *
 * This is not exactly-once delivery. Two failures leave `sending` or `failed`
 * with a null hash, so no link is active:
 * - The provider rejects the message: status becomes `failed`, and the next
 *   attempt creates a new token. That new text gets a new Resend idempotency
 *   key.
 * - The provider accepts the message and this process dies before the hash
 *   commit: status stays `sending`, `link_delivery_started_at` is old, and
 *   the hash stays null. After 90 seconds a retry or `npm run naming:deliver`
 *   sends a replacement. The earlier message, if it was accepted, does not
 *   resolve.
 * - The provider accepts the message and the hash update matches no row: the
 *   result is `uncommitted`, status is `failed`, and the same recovery sends
 *   a replacement.
 */
@Injectable()
export class NamingLinkDeliveryService {
  private readonly logger = new Logger(NamingLinkDeliveryService.name);
  private readonly tiers: readonly FareharborTierCheckout[];

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NamingMailer) private readonly mail: NamingMailer,
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(NAMING_CLOCK) private readonly clock: () => Date,
    @Optional()
    @Inject(FAREHARBOR_TIER_CHECKOUTS)
    tiers?: readonly FareharborTierCheckout[],
  ) {
    this.tiers = tiers ?? defaultFareharborTierCheckouts();
  }

  async deliver(
    reservationId: string,
    options: { reissue?: boolean } = {},
  ): Promise<NamingLinkDeliveryResult> {
    const baseUrl = this.env.namingPublicBaseUrl;
    if (!this.env.namingMailConfigured || !baseUrl) {
      return { outcome: "not_configured" };
    }

    const prepared = await this.prepare(reservationId, options);
    if (prepared.outcome !== "locked") {
      return prepared;
    }

    const issued = createNamingToken();
    const message = namingLinkMessage(
      prepared.objectName,
      namingLinkUrl(baseUrl, issued.token),
    );
    try {
      await this.mail.send({
        reservationId,
        to: prepared.address,
        subject: message.subject,
        text: message.text,
      });
    } catch {
      await this.markFailed(reservationId);
      this.logger.warn(
        `Naming link send failed for reservation ${reservationId}.`,
      );
      return { outcome: "smtp_failed" };
    }

    const stored = await this.storeHash(reservationId, issued.hash);
    if (stored) {
      return { outcome: "sent" };
    }

    const [row] = await this.database.db
      .select({
        status: namingReservations.status,
        reviewReason: namingReservations.reviewReason,
        namingTokenHash: namingReservations.namingTokenHash,
        linkDeliveryStatus: namingReservations.linkDeliveryStatus,
      })
      .from(namingReservations)
      .where(eq(namingReservations.id, reservationId))
      .limit(1);
    if (
      row?.namingTokenHash &&
      row.linkDeliveryStatus === "sent"
    ) {
      return { outcome: "already_sent" };
    }
    await this.markFailed(reservationId);
    if (!row || row.status !== "claimed" || row.reviewReason) {
      this.logger.warn(
        `Naming link was accepted then withheld for reservation ${reservationId}.`,
      );
      return { outcome: "not_eligible" };
    }
    this.logger.warn(
      `Naming link was accepted but not stored for reservation ${reservationId}.`,
    );
    return { outcome: "uncommitted" };
  }

  async resendCertificate(
    reservationId: string,
  ): Promise<NamingLinkDeliveryResult> {
    const baseUrl = this.env.namingPublicBaseUrl;
    if (!this.env.namingMailConfigured || !baseUrl) {
      return { outcome: "not_configured" };
    }
    const prepared = await this.prepareResend(reservationId);
    if (prepared.outcome !== "locked") {
      return prepared;
    }
    const issued = createNamingToken();
    const message = namingCertificateMessage(
      prepared.objectName,
      prepared.submittedName,
      namingLinkUrl(baseUrl, issued.token),
    );
    try {
      await this.mail.send({
        reservationId,
        to: prepared.address,
        subject: message.subject,
        text: message.text,
        scope: "naming-certificate",
      });
    } catch {
      await this.markResendFailed(reservationId);
      this.logger.warn(
        `Certificate resend failed for reservation ${reservationId}.`,
      );
      return { outcome: "smtp_failed" };
    }
    const stored = await this.storeResendHash(
      reservationId,
      prepared.previousHash,
      issued.hash,
    );
    if (stored) {
      return { outcome: "sent" };
    }
    await this.markResendFailed(reservationId);
    this.logger.warn(
      `Certificate resend was accepted but not stored for reservation ${reservationId}.`,
    );
    return { outcome: "uncommitted" };
  }

  private async prepare(
    reservationId: string,
    options: { reissue?: boolean },
  ): Promise<PreparedDelivery> {
    const now = this.clock();
    const staleBefore = new Date(now.getTime() - NAMING_LINK_DELIVERY_STALE_MS);
    return this.database.db.transaction(async (tx) => {
      const reservation = await lockReservation(tx, reservationId);
      if (!reservation) {
        return { outcome: "not_found" };
      }
      if (reservation.status !== "claimed" || reservation.reviewReason) {
        return { outcome: "not_eligible" };
      }
      if (
        options.reissue &&
        (reservation.submittedName || reservation.namedAt)
      ) {
        return { outcome: "already_named" };
      }
      if (reservation.namingTokenHash && !options.reissue) {
        return {
          outcome:
            reservation.linkDeliveryStatus === "sent"
              ? "already_sent"
              : "already_issued",
        };
      }
      const sendingFresh =
        reservation.linkDeliveryStatus === "sending" &&
        reservation.linkDeliveryStartedAt !== null &&
        reservation.linkDeliveryStartedAt.getTime() > staleBefore.getTime();
      if (sendingFresh) {
        return { outcome: "in_progress" };
      }
      if (!reservation.fareharborBookingUuid || reservation.paidAmount === null) {
        return { outcome: "not_eligible" };
      }

      const address = await readVerifiedPurchaserAddress(
        tx,
        reservation.fareharborBookingUuid,
        reservation.paidAmount,
        itemIdsForPrice(this.tiers, reservation.priceAmount),
      );
      if (!address) {
        return { outcome: "not_eligible" };
      }
      const [object] = await tx
        .select({ name: namingObjects.name })
        .from(namingObjects)
        .where(eq(namingObjects.id, reservation.objectId))
        .limit(1);
      if (!object) {
        return { outcome: "not_eligible" };
      }

      const [locked] = await tx
        .update(namingReservations)
        .set({
          namingTokenHash: null,
          linkDeliveryStatus: "sending",
          linkDeliveryStartedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(namingReservations.id, reservation.id),
            eq(namingReservations.status, "claimed"),
            isNull(namingReservations.reviewReason),
            isNull(namingReservations.submittedName),
            isNull(namingReservations.namedAt),
            reservation.namingTokenHash
              ? eq(
                  namingReservations.namingTokenHash,
                  reservation.namingTokenHash,
                )
              : isNull(namingReservations.namingTokenHash),
            options.reissue
              ? or(
                  isNull(namingReservations.linkDeliveryStatus),
                  eq(namingReservations.linkDeliveryStatus, "failed"),
                  eq(namingReservations.linkDeliveryStatus, "sent"),
                  and(
                    eq(namingReservations.linkDeliveryStatus, "sending"),
                    lt(namingReservations.linkDeliveryStartedAt, staleBefore),
                  ),
                )
              : or(
                  isNull(namingReservations.linkDeliveryStatus),
                  eq(namingReservations.linkDeliveryStatus, "failed"),
                  and(
                    eq(namingReservations.linkDeliveryStatus, "sending"),
                    lt(namingReservations.linkDeliveryStartedAt, staleBefore),
                  ),
                ),
          ),
        )
        .returning({ id: namingReservations.id });
      if (!locked) {
        return { outcome: "in_progress" };
      }
      return {
        outcome: "locked",
        address,
        objectName: object.name,
      };
    });
  }

  private async storeHash(reservationId: string, hash: string): Promise<boolean> {
    const [stored] = await this.database.db
      .update(namingReservations)
      .set({
        namingTokenHash: hash,
        linkDeliveryStatus: "sent",
        updatedAt: this.clock(),
      })
      .where(
        and(
          eq(namingReservations.id, reservationId),
          eq(namingReservations.status, "claimed"),
          isNull(namingReservations.reviewReason),
          isNull(namingReservations.namingTokenHash),
          eq(namingReservations.linkDeliveryStatus, "sending"),
        ),
      )
      .returning({ id: namingReservations.id });
    return Boolean(stored);
  }

  private async markFailed(reservationId: string): Promise<void> {
    await this.database.db
      .update(namingReservations)
      .set({
        linkDeliveryStatus: "failed",
        updatedAt: this.clock(),
      })
      .where(
        and(
          eq(namingReservations.id, reservationId),
          eq(namingReservations.linkDeliveryStatus, "sending"),
          isNull(namingReservations.namingTokenHash),
        ),
      );
  }

  private async prepareResend(reservationId: string): Promise<PreparedResend> {
    const now = this.clock();
    const staleBefore = new Date(now.getTime() - NAMING_LINK_DELIVERY_STALE_MS);
    return this.database.db.transaction(async (tx) => {
      const reservation = await lockReservation(tx, reservationId);
      if (!reservation) {
        return { outcome: "not_found" };
      }
      if (
        reservation.status !== "claimed" ||
        reservation.reviewReason ||
        !reservation.submittedName ||
        !reservation.namedAt ||
        !reservation.namingTokenHash ||
        !reservation.fareharborBookingUuid ||
        reservation.paidAmount === null
      ) {
        return { outcome: "not_eligible" };
      }
      const sendingFresh =
        reservation.linkResendStatus === "sending" &&
        reservation.linkResendStartedAt !== null &&
        reservation.linkResendStartedAt.getTime() > staleBefore.getTime();
      if (sendingFresh) {
        return { outcome: "in_progress" };
      }
      const address = await readVerifiedPurchaserAddress(
        tx,
        reservation.fareharborBookingUuid,
        reservation.paidAmount,
        itemIdsForPrice(this.tiers, reservation.priceAmount),
      );
      if (!address) {
        return { outcome: "not_eligible" };
      }
      const [object] = await tx
        .select({ name: namingObjects.name })
        .from(namingObjects)
        .where(eq(namingObjects.id, reservation.objectId))
        .limit(1);
      if (!object) {
        return { outcome: "not_eligible" };
      }
      const [locked] = await tx
        .update(namingReservations)
        .set({
          linkResendStatus: "sending",
          linkResendStartedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(namingReservations.id, reservation.id),
            eq(namingReservations.status, "claimed"),
            isNull(namingReservations.reviewReason),
            eq(namingReservations.namingTokenHash, reservation.namingTokenHash),
            isNotNull(namingReservations.submittedName),
            or(
              isNull(namingReservations.linkResendStatus),
              eq(namingReservations.linkResendStatus, "failed"),
              eq(namingReservations.linkResendStatus, "sent"),
              and(
                eq(namingReservations.linkResendStatus, "sending"),
                lt(namingReservations.linkResendStartedAt, staleBefore),
              ),
            ),
          ),
        )
        .returning({ id: namingReservations.id });
      if (!locked) {
        return { outcome: "in_progress" };
      }
      return {
        outcome: "locked",
        address,
        objectName: object.name,
        submittedName: reservation.submittedName,
        previousHash: reservation.namingTokenHash,
      };
    });
  }

  private async storeResendHash(
    reservationId: string,
    previousHash: string,
    hash: string,
  ): Promise<boolean> {
    const [stored] = await this.database.db
      .update(namingReservations)
      .set({
        namingTokenHash: hash,
        linkResendStatus: "sent",
        linkResendCount: sql`${namingReservations.linkResendCount} + 1`,
        updatedAt: this.clock(),
      })
      .where(
        and(
          eq(namingReservations.id, reservationId),
          eq(namingReservations.status, "claimed"),
          eq(namingReservations.linkResendStatus, "sending"),
          eq(namingReservations.namingTokenHash, previousHash),
          isNotNull(namingReservations.submittedName),
        ),
      )
      .returning({ id: namingReservations.id });
    return Boolean(stored);
  }

  private async markResendFailed(reservationId: string): Promise<void> {
    await this.database.db
      .update(namingReservations)
      .set({
        linkResendStatus: "failed",
        updatedAt: this.clock(),
      })
      .where(
        and(
          eq(namingReservations.id, reservationId),
          eq(namingReservations.linkResendStatus, "sending"),
          isNotNull(namingReservations.namingTokenHash),
        ),
      );
  }
}

function itemIdsForPrice(
  tiers: readonly FareharborTierCheckout[],
  priceCents: number,
): ReadonlySet<string> {
  const itemId = expectedFareharborItemId(tiers, priceCents);
  return itemId ? new Set([itemId]) : new Set();
}

export async function readVerifiedPurchaserAddress(
  tx: NamingTx,
  bookingUuid: string,
  paidAmount: number,
  allowedItemIds?: ReadonlySet<string>,
): Promise<string | undefined> {
  const rows = await tx
    .select({ payload: integrationEvents.payload })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
        eq(integrationEvents.externalEntityId, bookingUuid),
        isNull(integrationEvents.duplicateOf),
      ),
    )
    .orderBy(asc(integrationEvents.receivedAt));

  let address: string | undefined;
  for (const row of rows) {
    const reading = readFareharborGiftCard(row.payload, allowedItemIds);
    if (reading.kind !== "payable" && reading.kind !== "refunded") {
      continue;
    }
    if (reading.bookingUuid !== bookingUuid) {
      continue;
    }
    if (reading.kind === "refunded") {
      return undefined;
    }
    if (reading.paidAmount !== paidAmount) {
      return undefined;
    }
    address ??= readNamingPurchaserAddress(row.payload);
  }
  return address;
}

async function lockReservation(tx: NamingTx, reservationId: string) {
  const [reservation] = await tx
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, reservationId))
    .limit(1)
    .for("update");
  return reservation;
}
