import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { FareharborReportImportService } from "./fareharbor-report-import.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseArgs(process.argv.slice(2));
  if (!command) {
    console.error(
      "Usage: npm run import:fareharbor-report -- --file /path/to/report.csv [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const importer = app.get(FareharborReportImportService);
    const result = await importer.importFile(command.file, {
      dryRun: command.dryRun,
    });
    printSummary(result);
    if (result.outcome !== "ok") {
      process.exitCode = 1;
    } else if (
      result.unknownItemRows > 0 ||
      result.invalidRows > 0 ||
      result.conflictingItemLabels.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function parseArgs(
  argv: string[],
): { file: string; dryRun: boolean } | undefined {
  let file: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--file") {
      file = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    }
  }

  const trimmed = file?.trim();
  if (!trimmed) {
    return undefined;
  }
  return { file: trimmed, dryRun };
}

function printSummary(
  result: Awaited<ReturnType<FareharborReportImportService["importFile"]>>,
): void {
  if (result.outcome === "invalid_file") {
    console.error(
      `FareHarbor report file was refused (${result.reason ?? "invalid"}).`,
    );
    return;
  }

  console.log(
    result.dryRun
      ? "FareHarbor booking report dry run"
      : "FareHarbor booking report import",
  );
  console.log("");
  console.log(`Rows: ${result.rows}`);
  console.log(`Bookings: ${result.bookings}`);
  console.log(`Cancelled: ${result.cancelled}`);
  console.log(`Total pax: ${result.totalPax}`);
  console.log(`Mapped experience rows: ${result.mappedExperienceRows}`);
  console.log(`Applied: ${result.applied}`);
  console.log(`Non-experience skipped: ${result.nonExperienceSkipped}`);
  console.log(`Unknown item rows: ${result.unknownItemRows}`);
  console.log(`Invalid rows: ${result.invalidRows}`);
  if (result.unknownItemLabels.length > 0) {
    console.log("Unknown item labels:");
    for (const label of result.unknownItemLabels) {
      console.log(`- ${label}`);
    }
  }
  if (result.conflictingItemLabels.length > 0) {
    console.log("Conflicting item labels (mapped and classified):");
    for (const label of result.conflictingItemLabels) {
      console.log(`- ${label}`);
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "import failed";
  console.error(message);
  process.exitCode = 1;
});
