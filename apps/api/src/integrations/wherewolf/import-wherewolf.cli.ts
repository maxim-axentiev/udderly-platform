import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { FARM_TIME_ZONE } from "./wherewolf.range";
import { WherewolfImportService } from "./wherewolf-import.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const window = parseArgs(process.argv.slice(2));
  if (!window) {
    console.error(
      "Usage: npm run import:wherewolf -- --date YYYY-MM-DD",
    );
    console.error(
      "   or: npm run import:wherewolf -- --from YYYY-MM-DD --to YYYY-MM-DD",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const importer = app.get(WherewolfImportService);
    const result = await importer.importWindow(window);
    console.log("Wherewolf import");
    console.log("");
    if ("date" in window) {
      console.log(`Date: ${window.date} (${FARM_TIME_ZONE})`);
    } else {
      console.log(`From: ${window.from} (${FARM_TIME_ZONE})`);
      console.log(`To: ${window.to} (${FARM_TIME_ZONE}, inclusive)`);
    }
    console.log(`Reservations fetched: ${result.reservationsFetched}`);
    console.log(`Guests fetched: ${result.guestsFetched}`);
    console.log(`Snapshots inserted: ${result.snapshotsInserted}`);
    console.log(`Snapshots unchanged: ${result.snapshotsUnchanged}`);
  } finally {
    await app.close();
  }
}

function parseArgs(
  argv: string[],
): { date: string } | { from: string; to: string } | undefined {
  let date: string | undefined;
  let from: string | undefined;
  let to: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") {
      date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--from") {
      from = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
      continue;
    }
    if (arg === "--to") {
      to = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    }
  }

  const trimmedDate = date?.trim();
  const trimmedFrom = from?.trim();
  const trimmedTo = to?.trim();
  if (trimmedDate && !trimmedFrom && !trimmedTo) {
    return { date: trimmedDate };
  }
  if (!trimmedDate && trimmedFrom && trimmedTo) {
    return { from: trimmedFrom, to: trimmedTo };
  }
  return undefined;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "import failed";
  console.error(message);
  process.exitCode = 1;
});
