import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  defaultFareharborTierCheckouts,
  expectedFareharborItemId,
  type FareharborTierCheckout,
} from "@udderly/shared";
import { and, eq, lt, or } from "drizzle-orm";
import { EnvService } from "../config/env.service";
import { DatabaseService } from "../database/database.service";
import {
  namingNotices,
  namingObjects,
  namingReservations,
  type NamingNoticeKind,
} from "../database/schema/naming";
import { readVerifiedPurchaserAddress } from "./naming-link-delivery.service";
import { NamingMailer } from "./naming-mailer";
import { namingNoticeMessage } from "./naming-notice";
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

export type NamingNoticeResult =
  | { outcome: "sent" }
  | { outcome: "already_sent" }
  | { outcome: "in_progress" }
  | { outcome: "not_eligible" }
  | { outcome: "not_found" }
  | { outcome: "not_configured" }
  | { outcome: "smtp_failed" };

type PreparedNotice =
  | Exclude<NamingNoticeResult, { outcome: "sent" | "smtp_failed" }>
  | { outcome: "locked"; address: string; objectName: string; priceCents: number };

/**
 * Sends one non-qualification notice. The message has no token, so a retry
 * uses the same Resend idempotency key. The unique notice row stops a second
 * send after the first one is recorded.
 */
@Injectable()
export class NamingNoticeService {
  private readonly logger = new Logger(NamingNoticeService.name);
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
    kind: NamingNoticeKind,
  ): Promise<NamingNoticeResult> {
    if (!this.env.namingMailConfigured) {
      return { outcome: "not_configured" };
    }
    const prepared = await this.prepare(reservationId, kind);
    if (prepared.outcome !== "locked") {
      return prepared;
    }
    const message = namingNoticeMessage(
      kind,
      prepared.objectName,
      prepared.priceCents,
    );
    try {
      await this.mail.send({
        reservationId,
        to: prepared.address,
        subject: message.subject,
        text: message.text,
        scope: "naming-notice",
      });
    } catch {
      await this.markFailed(reservationId, kind);
      this.logger.warn(
        `Naming notice ${kind} failed for reservation ${reservationId}.`,
      );
      return { outcome: "smtp_failed" };
    }
    const stored = await this.markSent(reservationId, kind);
    if (stored) {
      return { outcome: "sent" };
    }
    return { outcome: "already_sent" };
  }

  private async prepare(
    reservationId: string,
    kind: NamingNoticeKind,
  ): Promise<PreparedNotice> {
    const now = this.clock();
    const staleBefore = new Date(now.getTime() - NAMING_LINK_DELIVERY_STALE_MS);
    return this.database.db.transaction(async (tx) => {
      const [reservation] = await tx
        .select()
        .from(namingReservations)
        .where(eq(namingReservations.id, reservationId))
        .limit(1)
        .for("update");
      if (!reservation) {
        return { outcome: "not_found" };
      }
      if (
        reservation.status !== "needs_review" ||
        reservation.reviewReason !== kind ||
        !reservation.fareharborBookingUuid ||
        reservation.paidAmount === null ||
        reservation.namingTokenHash ||
        reservation.submittedName
      ) {
        return { outcome: "not_eligible" };
      }
      const expectedItemId = expectedFareharborItemId(
        this.tiers,
        reservation.priceAmount,
      );
      const address = await readVerifiedPurchaserAddress(
        tx,
        reservation.fareharborBookingUuid,
        reservation.paidAmount,
        expectedItemId ? new Set([expectedItemId]) : new Set(),
      );
      if (!address) {
        return { outcome: "not_eligible" };
      }
      const [object] = await tx
        .select({
          name: namingObjects.name,
          priceCents: namingReservations.priceAmount,
        })
        .from(namingObjects)
        .innerJoin(
          namingReservations,
          eq(namingReservations.objectId, namingObjects.id),
        )
        .where(eq(namingReservations.id, reservation.id))
        .limit(1);
      if (!object) {
        return { outcome: "not_eligible" };
      }

      await tx
        .insert(namingNotices)
        .values({
          reservationId: reservation.id,
          kind,
          status: "failed",
          startedAt: now,
          attemptCount: 0,
        })
        .onConflictDoNothing({
          target: [namingNotices.reservationId, namingNotices.kind],
        });
      const [notice] = await tx
        .select()
        .from(namingNotices)
        .where(
          and(
            eq(namingNotices.reservationId, reservation.id),
            eq(namingNotices.kind, kind),
          ),
        )
        .limit(1)
        .for("update");
      if (!notice) {
        return { outcome: "in_progress" };
      }
      if (notice.status === "sent") {
        return { outcome: "already_sent" };
      }
      const sendingFresh =
        notice.status === "sending" &&
        notice.startedAt.getTime() > staleBefore.getTime();
      if (sendingFresh) {
        return { outcome: "in_progress" };
      }
      const [locked] = await tx
        .update(namingNotices)
        .set({
          status: "sending",
          startedAt: now,
          sentAt: null,
          attemptCount: notice.attemptCount + 1,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(namingNotices.id, notice.id),
            or(
              eq(namingNotices.status, "failed"),
              and(
                eq(namingNotices.status, "sending"),
                lt(namingNotices.startedAt, staleBefore),
              ),
            ),
          ),
        )
        .returning({ id: namingNotices.id });
      if (!locked) {
        return { outcome: "in_progress" };
      }
      return {
        outcome: "locked",
        address,
        objectName: object.name,
        priceCents: object.priceCents,
      };
    });
  }

  private async markSent(
    reservationId: string,
    kind: NamingNoticeKind,
  ): Promise<boolean> {
    const now = this.clock();
    const provider = this.env.namingResend ? "resend" : "smtp";
    const [stored] = await this.database.db
      .update(namingNotices)
      .set({
        status: "sent",
        sentAt: now,
        provider,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(namingNotices.reservationId, reservationId),
          eq(namingNotices.kind, kind),
          eq(namingNotices.status, "sending"),
        ),
      )
      .returning({ id: namingNotices.id });
    return Boolean(stored);
  }

  private async markFailed(
    reservationId: string,
    kind: NamingNoticeKind,
  ): Promise<void> {
    await this.database.db
      .update(namingNotices)
      .set({
        status: "failed",
        lastError: "naming_notice_send_failed",
        updatedAt: this.clock(),
      })
      .where(
        and(
          eq(namingNotices.reservationId, reservationId),
          eq(namingNotices.kind, kind),
          eq(namingNotices.status, "sending"),
        ),
      );
  }
}

export type { NamingTx };
