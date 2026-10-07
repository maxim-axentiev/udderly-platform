import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { GoogleSearchConsoleImportService } from "./google-search-console-import.service";
import {
  formatGscImportPlan,
  parseGscImportArgs,
} from "./google-search-console.import-plan";
import { assertHistoricalGscRange } from "./google-search-console.range";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  try {
    const plan = parseGscImportArgs(args);
    if (plan.dryRun) {
      for (const line of formatGscImportPlan(plan)) {
        console.log(line);
      }
      return;
    }

    loadEnvFiles();
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ["error", "warn"],
    });

    try {
      const importer = app.get(GoogleSearchConsoleImportService);
      const site = await importer.importSiteConfig();
      console.log(
        `site ${site.siteUrl} permission=${site.permissionLevel ?? "(unknown)"}`,
      );
      if (plan.siteOnly) {
        return;
      }
      if (!plan.from || !plan.to) {
        process.exitCode = 1;
        return;
      }
      assertHistoricalGscRange(plan.from, plan.to);
      const imported = await importer.importReports({
        startDate: plan.from,
        endDate: plan.to,
      });
      const verdict = importer.reconcileImportedWindow(imported);
      console.log(
        `import ${plan.from}..${plan.to} ${verdict.passed ? "PASS" : "FAIL"} published=${imported.publishedDates.length} unpublished=${imported.possiblyUnpublishedDates.length}`,
      );
      for (const family of imported.families) {
        console.log(
          `${family.family} rows=${family.sourceRows} requests=${family.requestCount} rowCount=${family.providerRowCount}`,
        );
      }
      for (const line of verdict.diagnostics) {
        console.log(line);
      }
      if (!verdict.passed) {
        console.error(verdict.differences.join("\n"));
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
