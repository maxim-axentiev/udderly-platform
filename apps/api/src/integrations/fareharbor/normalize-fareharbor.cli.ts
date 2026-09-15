import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { FareharborNormalizeService } from "./fareharbor-normalize.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const selection = parseArgs(process.argv.slice(2));
  if (!selection) {
    console.error(
      "Usage: npm run normalize:fareharbor -- --event-id <uuid> | --latest",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const normalizer = app.get(FareharborNormalizeService);
    const result =
      selection.latest === true
        ? await normalizer.normalizeLatest()
        : await normalizer.normalizeEvent(selection.eventId);
    printResult(result);
    if (
      result.outcome === "not_found" ||
      result.outcome === "invalid"
    ) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function parseArgs(
  argv: string[],
): { latest: true } | { latest: false; eventId: string } | undefined {
  let eventId: string | undefined;
  let latest = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--latest") {
      latest = true;
      continue;
    }

    if (arg === "--event-id") {
      eventId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--event-id=")) {
      eventId = arg.slice("--event-id=".length);
    }
  }

  if (latest && eventId) {
    return undefined;
  }

  if (latest) {
    return { latest: true };
  }

  if (eventId?.trim()) {
    return { latest: false, eventId: eventId.trim() };
  }

  return undefined;
}

function printResult(
  result: Awaited<
    ReturnType<FareharborNormalizeService["normalizeEvent"]>
  >,
): void {
  if (result.outcome === "applied") {
    console.log(
      `Normalized FareHarbor event ${result.eventId} (${result.bookingStatus})`,
    );
    return;
  }

  if (result.outcome === "skipped_stale") {
    console.log(
      "Skipped operational update because a newer FareHarbor event exists for this booking.",
    );
    return;
  }

  if (result.outcome === "mapping_required") {
    const pk = result.itemPk ?? "unknown";
    const name = result.itemName ? ` (${result.itemName})` : "";
    console.log(`mapping required: FareHarbor item ${pk}${name}`);
    return;
  }

  if (result.outcome === "not_found") {
    console.error("FareHarbor integration event not found.");
    return;
  }

  if (result.reason === "duplicate") {
    console.error(
      "This row is a duplicate receipt. Normalize the original event instead.",
    );
    return;
  }

  console.error("Not a FareHarbor booking event.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "normalize failed";
  console.error(message);
  process.exitCode = 1;
});
