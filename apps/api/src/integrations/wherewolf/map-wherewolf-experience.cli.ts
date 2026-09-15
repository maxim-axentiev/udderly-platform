import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { WherewolfExperienceMapService } from "./wherewolf-experience-map.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseArgs(process.argv.slice(2));
  if (!command) {
    console.error(
      'Usage: npm run map:wherewolf-experience -- --activity-id <id> --name "Experience name"',
    );
    console.error(
      "   or: npm run map:wherewolf-experience -- --activity-id <id> --experience-id <uuid>",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const mapper = app.get(WherewolfExperienceMapService);
    const result = await mapper.mapActivity(command);
    printResult(result);
    if (result.outcome !== "created" && result.outcome !== "unchanged") {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function parseArgs(
  argv: string[],
):
  | { activityId: string; name: string }
  | { activityId: string; experienceId: string }
  | undefined {
  let activityId: string | undefined;
  let name: string | undefined;
  let experienceId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--activity-id") {
      activityId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--activity-id=")) {
      activityId = arg.slice("--activity-id=".length);
      continue;
    }
    if (arg === "--name") {
      name = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }
    if (arg === "--experience-id") {
      experienceId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--experience-id=")) {
      experienceId = arg.slice("--experience-id=".length);
    }
  }

  const trimmedActivity = activityId?.trim();
  const trimmedName = name?.trim();
  const trimmedExperience = experienceId?.trim();
  if (!trimmedActivity) {
    return undefined;
  }
  if (trimmedName && !trimmedExperience) {
    return { activityId: trimmedActivity, name: trimmedName };
  }
  if (trimmedExperience && !trimmedName) {
    return { activityId: trimmedActivity, experienceId: trimmedExperience };
  }
  return undefined;
}

function printResult(
  result: Awaited<ReturnType<WherewolfExperienceMapService["mapActivity"]>>,
): void {
  if (result.outcome === "created") {
    if (result.createdExperience) {
      console.log(
        `Created experience ${result.experienceId} and mapped Wherewolf activity ${result.activityId}`,
      );
      return;
    }
    console.log(
      `Mapped Wherewolf activity ${result.activityId} to experience ${result.experienceId}`,
    );
    return;
  }

  if (result.outcome === "unchanged") {
    console.log(
      `Wherewolf activity ${result.activityId} already maps to experience ${result.experienceId}`,
    );
    return;
  }

  if (result.outcome === "conflict") {
    console.error(
      `Refused: Wherewolf activity ${result.activityId} is already mapped to experience ${result.mappedExperienceId}. Explicit remap is not implemented.`,
    );
    return;
  }

  if (result.outcome === "ambiguous_name") {
    console.error(
      `Refused: ${result.matchCount} canonical experiences are named exactly that. Pass --experience-id.`,
    );
    return;
  }

  if (result.outcome === "experience_not_found") {
    console.error(`Canonical experience ${result.experienceId} was not found.`);
    return;
  }

  console.error("Invalid mapping arguments.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "map failed";
  console.error(message);
  process.exitCode = 1;
});
