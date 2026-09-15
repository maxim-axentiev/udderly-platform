import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./columns";

export const experiences = pgTable("experience", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt,
  updatedAt,
});

/**
 * Curated assignment of a provider catalog object to a canonical experience.
 * Real FK to `experience`. Distinct from `source_identity`, which is the
 * unresolved-capable registry of any provider id (bookings, guests, customers).
 */
export const experienceSourceMappings = pgTable(
  "experience_source_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experienceId: uuid("experience_id").notNull(),
    provider: text("provider").notNull(),
    providerObjectType: text("provider_object_type").notNull(),
    externalId: text("external_id").notNull(),
    externalLabel: text("external_label"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("experience_source_mapping_provider_object_uidx").on(
      table.provider,
      table.providerObjectType,
      table.externalId,
    ),
    index("experience_source_mapping_experience_idx").on(table.experienceId),
    foreignKey({
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
      name: "experience_source_mapping_experience_id_fk",
    }).onDelete("restrict"),
  ],
);

export const sessions = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experienceId: uuid("experience_id").notNull(),
    startAt: timestamptz("start_at").notNull(),
    endAt: timestamptz("end_at"),
    capacity: integer("capacity"),
    status: text("status"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("session_experience_start_idx").on(table.experienceId, table.startAt),
    foreignKey({
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
      name: "session_experience_id_fk",
    }).onDelete("restrict"),
  ],
);
