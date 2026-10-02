import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { GoogleAnalyticsImportService } from "./google-analytics-import.service";
import {
  parseGaBackfillArgs,
  runGaBackfill,
} from "./google-analytics.backfill";
import { parseGaWindow } from "./google-analytics.range";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!parseGaWindow(args)) {
    console.error(
      "Usage: npm run backfill:google-analytics -- --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  if (args.includes("--dry-run")) {
    const plan = parseGaBackfillArgs(args);
    const result = await runGaBackfill(
      {
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
    const admin = await importer.importAdminConfig();
    const plan = parseGaBackfillArgs(args, { timeZone: admin.timezone });
    const result = await runGaBackfill(
      {
        importWindow: (window) =>
          importer.importReports({
            startDate: window.from,
            endDate: window.to,
          }),
        reconcileWindow: (imported) => importer.reconcileImportedWindow(imported),
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
}

void main();
