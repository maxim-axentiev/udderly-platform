import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const integrationEventStatuses = [
  "received",
  "queued",
  "processing",
  "completed",
  "failed",
  "duplicate",
] as const;

export type IntegrationEventStatus =
  (typeof integrationEventStatuses)[number];

export type IntegrationEventSafeMetadata = {
  bookingPk?: number | string;
  bookingStatus?: string;
  rebookedFrom?: string;
  rebookedTo?: string;
};

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    externalEntityType: text("external_entity_type"),
    externalEntityId: text("external_entity_id"),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    processingStatus: text("processing_status")
      .notNull()
      .default("received")
      .$type<IntegrationEventStatus>(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "date",
    }),
    processingError: text("processing_error"),
    duplicateOf: uuid("duplicate_of"),
    safeMetadata: jsonb("safe_metadata").$type<IntegrationEventSafeMetadata>(),
  },
  (table) => [
    index("integration_events_provider_entity_idx").on(
      table.provider,
      table.externalEntityType,
      table.externalEntityId,
    ),
    index("integration_events_provider_hash_idx").on(
      table.provider,
      table.payloadHash,
    ),
    index("integration_events_processing_status_idx").on(
      table.processingStatus,
    ),
    uniqueIndex("integration_events_original_hash_idx")
      .on(table.provider, table.payloadHash)
      .where(sql`${table.duplicateOf} is null`),
    foreignKey({
      columns: [table.duplicateOf],
      foreignColumns: [table.id],
      name: "integration_events_duplicate_of_fk",
    }),
  ],
);
