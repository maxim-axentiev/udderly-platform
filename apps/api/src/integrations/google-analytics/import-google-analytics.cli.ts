import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { GoogleAnalyticsImportService } from "./google-analytics-import.service";
import { assertHistoricalGaRange, parseGaWindow } from "./google-analytics.range";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const adminOnly = args.includes("--admin-only");
  const window = parseGaWindow(args);
  if (!adminOnly && !window) {
    console.error(
      "Usage: npm run import:google-analytics -- --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]\n       npm run import:google-analytics -- --admin-only",
    );
    process.exitCode = 1;
    return;
  }

  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const importer = app.get(GoogleAnalyticsImportService);
    const admin = await importer.importAdminConfig();
    console.log(
      `admin property=${admin.propertyId} timezone=${admin.timezone} currency=${admin.currency}`,
    );
    if (adminOnly) {
      return;
    }
    if (!window) {
      process.exitCode = 1;
      return;
    }
    assertHistoricalGaRange(window.from, window.to, admin.timezone);
    const imported = await importer.importReports({
      startDate: window.from,
      endDate: window.to,
      dryRun: args.includes("--dry-run"),
    });
    const verdict = importer.reconcileImportedWindow(imported);
    console.log(
      `import ${window.from}..${window.to} ${verdict.passed ? "PASS" : "FAIL"}`,
    );
    for (const family of imported.families) {
      console.log(
        `${family.family} rows=${family.sourceRows} requests=${family.requestCount} rowCount=${family.providerRowCount}`,
      );
    }
    if (!verdict.passed) {
      console.error(verdict.differences.join("\n"));
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main();
