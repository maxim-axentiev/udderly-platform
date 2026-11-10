import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  namingNameRevisions,
  namingObjects,
  namingReservations,
} from "../database/schema/naming";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";
import { normalizeSubmittedName } from "./naming-link";
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
}
