import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

/**
 * Provider ids. `internal_entity_type` / `internal_entity_id` are polymorphic
 * and nullable (unresolved identities). PostgreSQL cannot FK those columns to
 * multiple tables; resolution is application-enforced.
 */
export const sourceIdentities = pgTable(
  "source_identity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    internalEntityType: text("internal_entity_type"),
    internalEntityId: uuid("internal_entity_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("source_identity_provider_type_external_uidx").on(
      table.provider,
      table.entityType,
      table.externalId,
    ),
    index("source_identity_internal_idx").on(
      table.internalEntityType,
      table.internalEntityId,
    ),
    check(
      "source_identity_internal_pair",
      sql`(${table.internalEntityType} is null) = (${table.internalEntityId} is null)`,
    ),
  ],
);
