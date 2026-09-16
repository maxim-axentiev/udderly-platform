import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { integrationEvents } from "../../database/schema/integration-events";
import {
  FAREHARBOR_BOOKING_EVENT_TYPE,
  FAREHARBOR_PROVIDER,
} from "./fareharbor.crypto";
import { FareharborIdentityConflictError } from "./fareharbor-identity";
import { FareharborNormalizer } from "./fareharbor-normalizer";
import { extractFareharborBookingSnapshot } from "./fareharbor.snapshot";

export type FareharborNormalizeResult =
  | { outcome: "applied"; eventId: string; bookingStatus: string }
  | { outcome: "skipped_stale"; eventId: string }
  | {
      outcome: "mapping_required";
      eventId: string;
      itemPk?: string;
      itemName?: string;
    }
  | { outcome: "not_found" }
  | { outcome: "invalid"; reason: "duplicate" | "not_fareharbor" }
  | {
      outcome: "identity_conflict";
      eventId: string;
      kind: "booking" | "session";
    };

@Injectable()
export class FareharborNormalizeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FareharborNormalizer)
    private readonly normalizer: FareharborNormalizer,
  ) {}

  async normalizeLatest(): Promise<FareharborNormalizeResult> {
    const [latest] = await this.database.db
      .select({ id: integrationEvents.id })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          eq(integrationEvents.eventType, FAREHARBOR_BOOKING_EVENT_TYPE),
          isNull(integrationEvents.duplicateOf),
        ),
      )
      .orderBy(desc(integrationEvents.receivedAt))
      .limit(1);

    if (!latest) {
      return { outcome: "not_found" };
    }

    return this.normalizeEvent(latest.id);
  }

  async normalizeEvent(eventId: string): Promise<FareharborNormalizeResult> {
    const rows = await this.database.db
      .select({
        id: integrationEvents.id,
        provider: integrationEvents.provider,
        duplicateOf: integrationEvents.duplicateOf,
        payload: integrationEvents.payload,
        receivedAt: integrationEvents.receivedAt,
        externalEntityId: integrationEvents.externalEntityId,
        safeMetadata: integrationEvents.safeMetadata,
      })
      .from(integrationEvents)
      .where(eq(integrationEvents.id, eventId))
      .limit(1);

    const event = rows[0];
    if (!event) {
      return { outcome: "not_found" };
    }

    if (event.provider !== FAREHARBOR_PROVIDER) {
      return { outcome: "invalid", reason: "not_fareharbor" };
    }

    if (event.duplicateOf) {
      return { outcome: "invalid", reason: "duplicate" };
    }

    const snapshot = extractFareharborBookingSnapshot(event.payload);

    try {
      return await this.database.db.transaction(async (tx) => {
        if (event.externalEntityId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${event.externalEntityId}, 0))`,
          );
          const [newer] = await tx
            .select({ id: integrationEvents.id })
            .from(integrationEvents)
            .where(
              and(
                ne(integrationEvents.id, eventId),
                eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
                eq(integrationEvents.externalEntityId, event.externalEntityId),
                isNull(integrationEvents.duplicateOf),
                gt(
                  integrationEvents.receivedAt,
                  sql`(select received_at from integration_events where id = ${eventId})`,
                ),
              ),
            )
            .limit(1);
          if (newer) {
            return { outcome: "skipped_stale" as const, eventId };
          }
        }

        const applied = await this.normalizer.apply(
          tx,
          snapshot,
          event.receivedAt,
        );
        if (applied.outcome === "mapping_required") {
          return {
            outcome: "mapping_required" as const,
            eventId,
            itemPk: applied.itemPk,
            itemName: applied.itemName,
          };
        }

        return {
          outcome: "applied" as const,
          eventId,
          bookingStatus: event.safeMetadata?.bookingStatus ?? snapshot.status,
        };
      });
    } catch (error: unknown) {
      if (error instanceof FareharborIdentityConflictError) {
        return {
          outcome: "identity_conflict" as const,
          eventId,
          kind: error.kind,
        };
      }
      throw error;
    }
  }
}
