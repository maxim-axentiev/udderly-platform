import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { MetaAdsImportService } from "./meta-ads-import.service";
import { META_ADS_IMPORT_LOCK_NAME } from "./meta-ads.constants";
import {
  parseMetaAdsIncrementalArgs,
  runMetaAdsIncremental,
} from "./meta-ads.incremental";
import { formatMetaAdsLockError } from "./meta-ads.lock";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--from") || args.includes("--to")) {
      console.error(
        "Incremental sync does not accept --from/--to. Use import:meta-ads for an explicit historical range.",
      );
      process.exitCode = 1;
      return;
    }

    const plan = parseMetaAdsIncrementalArgs(args);
    if (plan.dryRun) {
      const result = await runMetaAdsIncremental(
        {
          importAccountGraph: async () => {
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
      const importer = app.get(MetaAdsImportService);
      const database = app.get(DatabaseService);
      await database.withAdvisoryLock(META_ADS_IMPORT_LOCK_NAME, async () => {
        const result = await runMetaAdsIncremental(
          {
            importAccountGraph: () => importer.importAccountGraph(),
            importWindow: (window) =>
              importer.importInsights({
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
    console.error(formatMetaAdsLockError(message));
    process.exitCode = 1;
  }
}

void main();
