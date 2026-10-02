import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { GoogleAnalyticsImportService } from "./google-analytics-import.service";
import { GA_INCREMENTAL_LOCK_NAME } from "./google-analytics.constants";
import {
  parseGaIncrementalArgs,
  runGaIncremental,
} from "./google-analytics.incremental";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--from") || args.includes("--to")) {
      console.error(
        "Incremental sync does not accept --from/--to. Use backfill:google-analytics for a bounded historical range.",
      );
      process.exitCode = 1;
      return;
    }

    parseGaIncrementalArgs(args);

    if (args.includes("--dry-run")) {
      const plan = parseGaIncrementalArgs(args);
      const result = await runGaIncremental(
        {
          importAdminConfig: async () => {
            throw new Error("dry_run");
          },
          importWindow: async () => {
            throw new Error("dry_run");
          },
          reconcileWindow: () => ({
            passed: true,
            differences: [],
            diagnostics: [],
            totals: { rangeLabel: "", families: [] },
          }),
        },
        plan,
        console.log,
      );
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }

    loadEnvFiles();
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn"],
    });

    try {
      const importer = app.get(GoogleAnalyticsImportService);
      const database = app.get(DatabaseService);
      await database.withAdvisoryLock(GA_INCREMENTAL_LOCK_NAME, async () => {
        const admin = await importer.importAdminConfig();
        const plan = parseGaIncrementalArgs(args, { timeZone: admin.timezone });
        const result = await runGaIncremental(
          {
            importWindow: (window) =>
              importer.importReports({
                startDate: window.from,
                endDate: window.to,
              }),
            reconcileWindow: (imported) =>
              importer.reconcileImportedWindow(imported),
          },
          plan,
          console.log,
        );
        if (!result.ok) {
          process.exitCode = 1;
        }
      });
    } finally {
      await app.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "advisory_lock_busy") {
      console.error("ga_incremental_already_running");
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

void main();
