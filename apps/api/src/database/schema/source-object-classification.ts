import {
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

/**
 * Explicit provider-object classifications that are not experience mappings.
 * Used for FareHarbor report item labels such as Gift Card.
 */
export const sourceObjectClassifications = pgTable(
  "source_object_classification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    providerObjectType: text("provider_object_type").notNull(),
    externalId: text("external_id").notNull(),
    classification: text("classification").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("source_object_classification_uidx").on(
      table.provider,
      table.providerObjectType,
      table.externalId,
    ),
    index("source_object_classification_class_idx").on(table.classification),
  ],
);
