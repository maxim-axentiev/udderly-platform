import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { FareharborReportItemClassifyService } from "./fareharbor-report-item-classify.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseArgs(process.argv.slice(2));
  if (!command) {
    console.error(
      'Usage: npm run classify:fareharbor-report-item -- --item-label "Gift Card" --non-experience',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const classifier = app.get(FareharborReportItemClassifyService);
    const result = await classifier.classifyNonExperience(command.itemLabel);
    printResult(result);
    if (result.outcome !== "created" && result.outcome !== "unchanged") {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): { itemLabel: string } | undefined {
  let itemLabel: string | undefined;
  let nonExperience = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--non-experience") {
      nonExperience = true;
      continue;
    }
    if (arg === "--item-label") {
      itemLabel = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--item-label=")) {
      itemLabel = arg.slice("--item-label=".length);
    }
  }

  const trimmed = itemLabel?.trim();
  if (!trimmed || !nonExperience) {
    return undefined;
  }
  return { itemLabel: trimmed };
}

function printResult(
  result: Awaited<
    ReturnType<FareharborReportItemClassifyService["classifyNonExperience"]>
  >,
): void {
  if (result.outcome === "created") {
    console.log(
      `Classified FareHarbor report item ${result.itemLabel} as ${result.classification}`,
    );
    return;
  }
  if (result.outcome === "unchanged") {
    console.log(
      `FareHarbor report item ${result.itemLabel} is already ${result.classification}`,
    );
    return;
  }
  if (result.outcome === "conflict") {
    console.error(
      `Refused: FareHarbor report item ${result.itemLabel} is already ${result.existingClassification}.`,
    );
    return;
  }
  console.error("Invalid classification arguments.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "classify failed";
  console.error(message);
  process.exitCode = 1;
});
