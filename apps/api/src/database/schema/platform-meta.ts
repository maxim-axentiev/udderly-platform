import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const platformMeta = pgTable("platform_meta", {
  id: integer("id").primaryKey(),
  initializedAt: timestamp("initialized_at", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
});
