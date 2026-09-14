import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { loadEnvFiles } from "../config/load-env";
import { FareharborWebhookService } from "./fareharbor/fareharbor-webhook.service";

async function main(): Promise<void> {
  loadEnvFiles();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });

  try {
    const fareharbor = app.get(FareharborWebhookService);
    const result = await fareharbor.recoverEligibleEvents();

    console.log("INTEGRATION EVENT RECOVERY");
    console.log("");
    console.log(`- found: ${result.found}`);
    console.log(`- enqueued: ${result.enqueued}`);
    console.log(`- skipped: ${result.skipped}`);
    console.log(`- failed: ${result.failed}`);
    console.log("");
    console.log(
      "Eligible statuses: received, queued, processing, failed. Duplicates and completed events are skipped.",
    );

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "recovery failed";
  console.error(message);
  process.exitCode = 1;
});
