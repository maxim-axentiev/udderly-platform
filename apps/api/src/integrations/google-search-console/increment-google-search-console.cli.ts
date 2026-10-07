import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { GoogleSearchConsoleImportService } from "./google-search-console-import.service";
import { GSC_INCREMENTAL_LOCK_NAME } from "./google-search-console.constants";
import {
  parseGscIncrementalArgs,
  runGscIncremental,
} from "./google-search-console.incremental";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--from") || args.includes("--to")) {
      console.error(
        "Incremental sync does not accept --from/--to. Use backfill:google-search-console for a bounded historical range.",
      );
      process.exitCode = 1;
      return;
    }

    const plan = parseGscIncrementalArgs(args);
    if (plan.dryRun) {
      const result = await runGscIncremental(
        {
          importSiteConfig: async () => {
            throw new Error("dry_run");
          },
          importWindow: async () => {
            throw new Error("dry_run");
          },
          reconcileWindow: () => {
            throw new Error("dry_run");
          },
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
      const importer = app.get(GoogleSearchConsoleImportService);
      const database = app.get(DatabaseService);
      await database.withAdvisoryLock(GSC_INCREMENTAL_LOCK_NAME, async () => {
        const result = await runGscIncremental(
          {
            importSiteConfig: () => importer.importSiteConfig(),
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
      console.error("gsc_incremental_already_running");
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}

void main();
