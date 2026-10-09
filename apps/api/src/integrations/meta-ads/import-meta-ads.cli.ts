import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import { MetaAdsImportService } from "./meta-ads-import.service";
import { META_ADS_IMPORT_LOCK_NAME } from "./meta-ads.constants";
import {
  formatMetaAdsImportPlan,
  parseMetaAdsImportArgs,
} from "./meta-ads.import-plan";
import { formatMetaAdsLockError } from "./meta-ads.lock";
import { assertHistoricalMetaAdsRange } from "./meta-ads.range";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    const plan = parseMetaAdsImportArgs(args);
    if (plan.dryRun) {
      for (const line of formatMetaAdsImportPlan(plan)) {
        console.log(line);
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
        const account = await importer.importAccountGraph();
        console.log(`account ${account.accountId} name=${account.name ?? "(unknown)"}`);
        if (plan.accountOnly) {
          return;
        }
        if (!plan.from || !plan.to) {
          process.exitCode = 1;
          return;
        }
        assertHistoricalMetaAdsRange(plan.from, plan.to);
        const imported = await importer.importInsights({
          startDate: plan.from,
          endDate: plan.to,
        });
        const verdict = importer.reconcileImportedWindow(imported);
        console.log(
          `import ${plan.from}..${plan.to} ${verdict.passed ? "PASS" : "FAIL"} published=${imported.publishedDates.length} unpublished=${imported.possiblyUnpublishedDates.length} replaced=${imported.replacedDates.length}`,
        );
        for (const level of imported.levels) {
          const replaced = imported.replacedDatesByLevel[level.level] ?? [];
          console.log(
            `${level.level} rows=${level.sourceRows} requests=${level.requestCount} rowCount=${level.providerRowCount} attribution=${level.attributionWindow} replaced=${replaced.join(",") || "(none)"}`,
          );
        }
        for (const line of verdict.diagnostics) {
          console.log(line);
        }
        if (!verdict.passed) {
          console.error(verdict.differences.join("\n"));
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
