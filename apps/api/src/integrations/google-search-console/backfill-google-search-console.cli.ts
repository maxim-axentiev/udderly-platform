import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { GoogleSearchConsoleImportService } from "./google-search-console-import.service";
import {
  parseGscBackfillArgs,
  runGscBackfill,
} from "./google-search-console.backfill";
import { parseGscWindow } from "./google-search-console.range";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    if (!parseGscWindow(args)) {
      console.error(
        "Usage: npm run backfill:google-search-console -- --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]",
      );
      process.exitCode = 1;
      return;
    }

    const plan = parseGscBackfillArgs(args);
    if (plan.dryRun) {
      const result = await runGscBackfill(
        {
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
      const result = await runGscBackfill(
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
    } finally {
      await app.close();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
