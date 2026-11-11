import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  namingObjects,
  namingReservations,
} from "../database/schema/naming";
import {
  createNamingToken,
  hashNamingToken,
  namingLinkPath,
} from "./naming-gift-card";
import { namingSubmissionOpen } from "./naming-deadline";
import { normalizeSubmittedName } from "./naming-link";
import { NAMING_CLOCK } from "./naming.constants";

type NamingTx = Parameters<DatabaseService["db"]["transaction"]>[0] extends (
  tx: infer Tx,
) => unknown
  ? Tx
  : never;

export type NamingLinkIssueResult =
  | { outcome: "issued"; token: string; path: string }
  | { outcome: "already_issued" }
  | { outcome: "already_named" }
  | { outcome: "not_found" }
  | { outcome: "not_claimed" };

export type NamingLinkResolution =
  | {
      outcome: "resolved";
      objectName: string;
      description: string;
      photoUrl: string | null;
      namingStatus: "awaiting_name" | "named";
      submittedName: string | null;
      submissionOpen: boolean;
    }
  | { outcome: "invalid" };

export type NamingSubmissionResult =
  | { outcome: "named"; submittedName: string }
  | { outcome: "already_named" }
  | { outcome: "payment_reversed" }
  | { outcome: "invalid" }
  | { outcome: "invalid_name" }
  | { outcome: "deadline_closed" };

/**
 * Issues one naming token for a claimed reservation and accepts one name.
 * PostgreSQL stores the SHA-256 hash. The plaintext token is returned only
 * to the caller that issued it.
 */
@Injectable()
export class NamingLinkService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NAMING_CLOCK) private readonly clock: () => Date,
  ) {}

  async issue(
    reservationId: string,
    options: { reissue?: boolean } = {},
  ): Promise<NamingLinkIssueResult> {
    return this.database.db.transaction(async (tx) => {
      const reservation = await lockReservation(tx, reservationId);
      if (!reservation) {
        return { outcome: "not_found" };
      }
      if (reservation.status !== "claimed") {
        return { outcome: "not_claimed" };
      }
      if (
        options.reissue &&
        (reservation.submittedName || reservation.namedAt)
      ) {
        return { outcome: "already_named" };
      }
      if (reservation.namingTokenHash && !options.reissue) {
        return { outcome: "already_issued" };
      }

      const issued = createNamingToken();
      const [updated] = await tx
        .update(namingReservations)
        .set({
          namingTokenHash: issued.hash,
          linkDeliveryStatus: null,
          linkDeliveryStartedAt: null,
          updatedAt: this.clock(),
        })
        .where(
          and(
            eq(namingReservations.id, reservation.id),
            eq(namingReservations.status, "claimed"),
            ...(options.reissue
              ? []
              : [isNull(namingReservations.namingTokenHash)]),
          ),
        )
        .returning({ id: namingReservations.id });
      if (!updated) {
        return { outcome: "already_issued" };
      }
      return {
        outcome: "issued",
        token: issued.token,
        path: namingLinkPath(issued.token),
      };
    });
  }

  async identify(
    token: string,
  ): Promise<{ objectId: string; isTest: boolean } | undefined> {
    const reservation = await this.findByToken(token);
    if (!reservation || reservation.status !== "claimed") {
      return undefined;
    }
    const [object] = await this.database.db
      .select({
        id: namingObjects.id,
        isTest: namingObjects.isTest,
      })
      .from(namingObjects)
      .where(eq(namingObjects.id, reservation.objectId))
      .limit(1);
    if (!object) {
      return undefined;
    }
    return { objectId: object.id, isTest: object.isTest };
  }

  async resolve(token: string): Promise<NamingLinkResolution> {
    const reservation = await this.findByToken(token);
    if (!reservation || reservation.status !== "claimed") {
      return { outcome: "invalid" };
    }
    const [object] = await this.database.db
      .select({
        name: namingObjects.name,
        description: namingObjects.description,
        photoUrl: namingObjects.photoUrl,
      })
      .from(namingObjects)
      .where(eq(namingObjects.id, reservation.objectId))
      .limit(1);
    if (!object) {
      return { outcome: "invalid" };
    }
    return {
      outcome: "resolved",
      objectName: object.name,
      description: object.description,
      photoUrl: object.photoUrl,
      namingStatus: reservation.namedAt ? "named" : "awaiting_name",
      submittedName: reservation.submittedName,
      submissionOpen: namingSubmissionOpen(this.clock()),
    };
  }

  async submit(token: string, rawName: string): Promise<NamingSubmissionResult> {
    const name = normalizeSubmittedName(rawName);
    if (!name) {
      return { outcome: "invalid_name" };
    }
    const hash = hashNamingToken(token);
    const now = this.clock();
    return this.database.db.transaction(async (tx) => {
      const reservation = await lockReservationByHash(tx, hash);
      if (!reservation || reservation.status !== "claimed") {
        return { outcome: "invalid" };
      }
      if (reservation.submittedName || reservation.namedAt) {
        return { outcome: "already_named" };
      }
      if (!namingSubmissionOpen(now)) {
        return { outcome: "deadline_closed" };
      }
      if (reservation.reviewReason === "payment_reversed") {
        return { outcome: "payment_reversed" };
      }

      const [named] = await tx
        .update(namingReservations)
        .set({
          submittedName: name,
          namedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(namingReservations.id, reservation.id),
            eq(namingReservations.status, "claimed"),
            eq(namingReservations.namingTokenHash, hash),
            isNull(namingReservations.submittedName),
            isNull(namingReservations.namedAt),
            or(
              isNull(namingReservations.reviewReason),
              ne(namingReservations.reviewReason, "payment_reversed"),
            ),
          ),
        )
        .returning({ id: namingReservations.id });
      if (!named) {
        const [current] = await tx
          .select({
            submittedName: namingReservations.submittedName,
            reviewReason: namingReservations.reviewReason,
          })
          .from(namingReservations)
          .where(eq(namingReservations.id, reservation.id))
          .limit(1);
        if (current?.reviewReason === "payment_reversed" && !current.submittedName) {
          return { outcome: "payment_reversed" };
        }
        return { outcome: "already_named" };
      }
      return { outcome: "named", submittedName: name };
    });
  }

  private async findByToken(token: string) {
    const [reservation] = await this.database.db
      .select({
        status: namingReservations.status,
        objectId: namingReservations.objectId,
        submittedName: namingReservations.submittedName,
        namedAt: namingReservations.namedAt,
      })
      .from(namingReservations)
      .where(eq(namingReservations.namingTokenHash, hashNamingToken(token)))
      .limit(1);
    return reservation;
  }
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

async function lockReservationByHash(tx: NamingTx, hash: string) {
  const [reservation] = await tx
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.namingTokenHash, hash))
    .limit(1)
    .for("update");
  return reservation;
}
