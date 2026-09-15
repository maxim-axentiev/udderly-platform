import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import {
  formatWherewolfInspect,
  WherewolfInspectService,
} from "./wherewolf-inspect.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const date = parseArgs(process.argv.slice(2));
  if (!date) {
    console.error("Usage: npm run inspect:wherewolf -- --date YYYY-MM-DD");
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const inspector = app.get(WherewolfInspectService);
    const summary = await inspector.inspectDate(date);
    console.log(formatWherewolfInspect(summary));
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): string | undefined {
  let date: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") {
      date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
    }
  }
  const trimmed = date?.trim();
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "inspect failed";
  console.error(message);
  process.exitCode = 1;
});
