import {
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./columns";

/**
 * Pull-API snapshots (Wherewolf, later Square). Not the FareHarbor webhook inbox.
 * Payload must already be sanitized before insert.
 * `observed_at` is when Goat Barn imported/observed the record, not the visit date.
 */
export const sourceSnapshots = pgTable(
  "source_snapshot",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    observedAt: timestamptz("observed_at").notNull().defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("source_snapshot_provider_entity_hash_uidx").on(
      table.provider,
      table.entityType,
      table.externalId,
      table.payloadHash,
    ),
    index("source_snapshot_provider_entity_observed_idx").on(
      table.provider,
      table.entityType,
      table.externalId,
      table.observedAt,
    ),
  ],
);
