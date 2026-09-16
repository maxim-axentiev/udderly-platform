import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../database/database.service";
import { sourceIdentities } from "../../database/schema/source-identity";
import { FAREHARBOR_PROVIDER } from "./fareharbor.crypto";

export type FareharborDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export class FareharborIdentityConflictError extends Error {
  readonly name = "FareharborIdentityConflictError";

  constructor(
    readonly kind: "booking" | "session",
    readonly details: {
      uuidBookingId?: string;
      pkBookingId?: string;
      existingInternalId?: string;
      attemptedInternalId?: string;
    },
  ) {
    super("fareharbor_identity_conflict");
  }
}

export function fareharborAvailabilityReportKey(
  experienceId: string,
  startAt: Date,
): string {
  return `${experienceId}:${startAt.toISOString()}`;
}

export async function findResolvedFareharborIdentity(
  db: FareharborDb,
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

export async function upsertFareharborIdentity(
  db: FareharborDb,
  entityType: string,
  externalId: string,
  internalEntityType?: string,
  internalEntityId?: string,
): Promise<string> {
  const rows = await db
    .select({
      id: sourceIdentities.id,
      internalEntityType: sourceIdentities.internalEntityType,
      internalEntityId: sourceIdentities.internalEntityId,
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

  const existing = rows[0];
  if (existing) {
    if (
      internalEntityType &&
      internalEntityId &&
      existing.internalEntityId &&
      (existing.internalEntityType !== internalEntityType ||
        existing.internalEntityId !== internalEntityId)
    ) {
      throw new FareharborIdentityConflictError(
        internalEntityType === "session" ? "session" : "booking",
        {
          existingInternalId: existing.internalEntityId,
          attemptedInternalId: internalEntityId,
        },
      );
    }

    if (internalEntityType && internalEntityId && !existing.internalEntityId) {
      await db
        .update(sourceIdentities)
        .set({
          internalEntityType,
          internalEntityId,
          updatedAt: new Date(),
        })
        .where(eq(sourceIdentities.id, existing.id));
    }
    return existing.id;
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
