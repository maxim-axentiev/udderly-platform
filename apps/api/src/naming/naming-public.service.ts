import { Inject, Injectable } from "@nestjs/common";
import { eq, isNotNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  namingObjects,
  namingReservations,
} from "../database/schema/naming";
import { isCustomerNamingObject } from "./naming-launch";
import { NamingLinkService } from "./naming-link.service";
import { NamingReservationService } from "./naming-reservation.service";
import { NAMING_CLOCK } from "./naming.constants";

export type PublicNamingObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
  availability: "available" | "held" | "claimed";
};

export type PublicReservationStatus = {
  reservationId: string;
  status:
    | "awaiting_payment"
    | "expired"
    | "paid"
    | "named"
    | "review"
    | "underpaid"
    | "purchase_closed";
  holdExpiresAt?: string;
  submittedName?: string;
  object: {
    id: string;
    name: string;
    description: string;
    photoUrl: string | null;
    priceCents: number;
    currency: string;
  };
};

@Injectable()
export class NamingPublicService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NamingReservationService)
    private readonly reservations: NamingReservationService,
    @Inject(NamingLinkService) private readonly links: NamingLinkService,
    @Inject(NAMING_CLOCK) private readonly clock: () => Date,
  ) {}

  async listPublished(): Promise<{ objects: PublicNamingObject[] }> {
    const objects = await this.database.db
      .select({
        id: namingObjects.id,
        name: namingObjects.name,
        description: namingObjects.description,
        photoUrl: namingObjects.photoUrl,
        priceCents: namingObjects.priceAmount,
        currency: namingObjects.currency,
        availability: namingObjects.status,
        isTest: namingObjects.isTest,
      })
      .from(namingObjects)
      .where(isNotNull(namingObjects.publishedAt))
      .orderBy(namingObjects.name);
    return {
      objects: objects.filter(isCustomerNamingObject).map((object) => ({
        id: object.id,
        name: object.name,
        description: object.description,
        photoUrl: object.photoUrl,
        priceCents: object.priceCents,
        currency: object.currency,
        availability: object.availability,
      })),
    };
  }

  createReservation(objectId: string) {
    return this.reservations.reserve(objectId);
  }

  async reservationStatus(
    reservationId: string,
  ): Promise<PublicReservationStatus | undefined> {
    const [reservation] = await this.database.db
      .select({
        id: namingReservations.id,
        objectId: namingReservations.objectId,
        status: namingReservations.status,
        holdExpiresAt: namingReservations.holdExpiresAt,
        submittedName: namingReservations.submittedName,
        namedAt: namingReservations.namedAt,
        reviewReason: namingReservations.reviewReason,
      })
      .from(namingReservations)
      .where(eq(namingReservations.id, reservationId))
      .limit(1);
    if (!reservation) {
      return undefined;
    }
    const [object] = await this.database.db
      .select({
        id: namingObjects.id,
        name: namingObjects.name,
        description: namingObjects.description,
        photoUrl: namingObjects.photoUrl,
        priceAmount: namingObjects.priceAmount,
        currency: namingObjects.currency,
      })
      .from(namingObjects)
      .where(eq(namingObjects.id, reservation.objectId))
      .limit(1);
    if (!object) {
      return undefined;
    }
    const body = {
      reservationId: reservation.id,
      object: {
        id: object.id,
        name: object.name,
        description: object.description,
        photoUrl: object.photoUrl,
        priceCents: object.priceAmount,
        currency: object.currency,
      },
    };
    if (reservation.status === "held") {
      if (
        reservation.holdExpiresAt &&
        reservation.holdExpiresAt.getTime() > this.clock().getTime()
      ) {
        return {
          ...body,
          status: "awaiting_payment",
          holdExpiresAt: reservation.holdExpiresAt.toISOString(),
        };
      }
      return { ...body, status: "expired" };
    }
    if (reservation.status === "released") {
      return { ...body, status: "expired" };
    }
    if (
      reservation.status === "claimed" &&
      reservation.submittedName &&
      reservation.namedAt
    ) {
      return {
        ...body,
        status: "named",
        submittedName: reservation.submittedName,
      };
    }
    if (reservation.status === "claimed") {
      return { ...body, status: "paid" };
    }
    if (reservation.reviewReason === "underpaid") {
      return { ...body, status: "underpaid" };
    }
    if (reservation.reviewReason === "purchase_after_deadline") {
      return { ...body, status: "purchase_closed" };
    }
    return { ...body, status: "review" };
  }

  resolveLink(token: string) {
    return this.links.resolve(token);
  }

  submitName(token: string, name: string) {
    return this.links.submit(token, name);
  }
}
