import { readFileSync } from "node:fs";
import { join } from "node:path";

const drizzleDirectory = join(__dirname, "../../drizzle");

export const NAMING_SCHEMA_MIGRATIONS = [
  "0012_naming.sql",
  "0013_naming_link_delivery.sql",
  "0014_naming_campaign_rules.sql",
  "0016_naming_test_object.sql",
] as const;

export async function applySqlMigrations(
  sql: { unsafe: (query: string) => Promise<unknown> },
  fileNames: readonly string[],
): Promise<void> {
  for (const fileName of fileNames) {
    const migration = readFileSync(join(drizzleDirectory, fileName), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) {
        await sql.unsafe(trimmed);
      }
    }
  }
}
