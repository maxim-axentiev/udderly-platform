import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { FARM_TIME_ZONE } from "./wherewolf.range";
import { WherewolfNormalizeService } from "./wherewolf-normalize.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseArgs(process.argv.slice(2));
  if (!command) {
    console.error(
      "Usage: npm run normalize:wherewolf -- --snapshot-id <uuid>",
    );
    console.error("   or: npm run normalize:wherewolf -- --date YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const normalizer = app.get(WherewolfNormalizeService);
    const run = await normalizer.normalize(command);
    printRun(run);
  } finally {
    await app.close();
  }
}

function parseArgs(
  argv: string[],
): { snapshotId: string } | { date: string } | undefined {
  let snapshotId: string | undefined;
  let date: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--snapshot-id") {
      snapshotId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--snapshot-id=")) {
      snapshotId = arg.slice("--snapshot-id=".length);
      continue;
    }
    if (arg === "--date") {
      date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
    }
  }

  const trimmedSnapshot = snapshotId?.trim();
  const trimmedDate = date?.trim();
  if (trimmedSnapshot && !trimmedDate) {
    return { snapshotId: trimmedSnapshot };
  }
  if (trimmedDate && !trimmedSnapshot) {
    return { date: trimmedDate };
  }
  return undefined;
}

function printRun(
  run: Awaited<ReturnType<WherewolfNormalizeService["normalize"]>>,
): void {
  console.log("Wherewolf normalization");
  console.log("");
  if (run.farmDate) {
    console.log(`Farm date: ${run.farmDate} (${FARM_TIME_ZONE})`);
    console.log(`Snapshots selected: ${run.results.length}`);
    console.log(`Skipped (no visit date): ${run.skippedNoVisitDate}`);
    console.log("");
  }

  if (run.results.length === 0) {
    console.log("Snapshots applied: 0");
    return;
  }

  const counts = {
    applied: 0,
    mapping_required: 0,
    insufficient_identity: 0,
    skipped_stale: 0,
    skipped: 0,
  };
  for (const result of resultsTally(run.results, counts)) {
    if (!run.farmDate) {
      printResult(result);
    }
  }

  if (run.farmDate) {
    console.log(`Visit applied: ${counts.applied}`);
    console.log(`mapping required: ${counts.mapping_required}`);
    console.log(
      `insufficient visit occurrence identity: ${counts.insufficient_identity}`,
    );
    console.log(`Skipped stale: ${counts.skipped_stale}`);
    console.log(`Skipped other: ${counts.skipped}`);
  }
}

function resultsTally(
  results: Awaited<ReturnType<WherewolfNormalizeService["normalize"]>>["results"],
  counts: {
    applied: number;
    mapping_required: number;
    insufficient_identity: number;
    skipped_stale: number;
    skipped: number;
  },
) {
  for (const result of results) {
    if (result.outcome === "applied") {
      counts.applied += 1;
    } else if (result.outcome === "mapping_required") {
      counts.mapping_required += 1;
    } else if (result.outcome === "insufficient_identity") {
      counts.insufficient_identity += 1;
    } else if (result.outcome === "skipped_stale") {
      counts.skipped_stale += 1;
    } else {
      counts.skipped += 1;
    }
  }
  return results;
}

function printResult(
  result: Awaited<
    ReturnType<WherewolfNormalizeService["normalize"]>
  >["results"][number],
): void {
  if (result.outcome === "applied") {
    console.log(`Snapshot: ${result.snapshotId}`);
    console.log(`Experience: ${result.experienceName}`);
    console.log(`Visit created: 1`);
    console.log(`Booking linked: ${result.bookingLinked ? "yes" : "no"}`);
    console.log(`Session linked: ${result.sessionLinked ? "yes" : "no"}`);
    console.log(
      "Attendance: source status preserved; unconfirmed. signed=true is not attendance.",
    );
    return;
  }
  if (result.outcome === "mapping_required") {
    const activity = result.activityId ?? "unknown";
    const name = result.activityName ? ` (${result.activityName})` : "";
    console.log(`mapping required: Wherewolf activity ${activity}${name}`);
    return;
  }
  if (result.outcome === "insufficient_identity") {
    console.log("insufficient visit occurrence identity");
    return;
  }
  if (result.outcome === "skipped_stale") {
    console.log(
      "Skipped operational update because a newer Wherewolf snapshot exists for this visit occurrence.",
    );
    return;
  }
  console.log("Snapshot skipped");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "normalize failed";
  console.error(message);
  process.exitCode = 1;
});
