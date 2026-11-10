import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { loadEnvFiles } from "../config/load-env";
import {
  parseNamingLinkCommand,
  usageText,
} from "./naming-link.command";
import { NamingLinkService } from "./naming-link.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseNamingLinkCommand(process.argv.slice(2));
  if (!command) {
    console.error(usageText());
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    const links = app.get(NamingLinkService);
    const result = await links.issue(command.reservationId, {
      reissue: command.reissue,
    });
    if (result.outcome === "issued") {
      console.log("Naming link issued. It is shown once and is not stored.");
      console.log(`path: ${result.path}`);
      return;
    }
    if (result.outcome === "already_issued") {
      console.error(
        "A naming link already exists. Reissue with --reissue to invalidate it.",
      );
    } else if (result.outcome === "already_named") {
      console.error(
        "This item is already named. The current link stays valid.",
      );
    } else if (result.outcome === "not_claimed") {
      console.error("Naming links can be issued only for a claimed reservation.");
    } else {
      console.error("Naming reservation was not found.");
    }
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "naming link failed";
  console.error(message);
  process.exitCode = 1;
});
