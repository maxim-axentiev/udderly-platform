import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { loadEnvFiles } from "../config/load-env";
import { NamingGiftCardDispatchService } from "./naming-gift-card.dispatch";

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const dispatch = app.get(NamingGiftCardDispatchService);
    const result = await dispatch.replayStoredGiftCards();
    console.log("NAMING GIFT CARD REPLAY");
    console.log(`- found: ${result.found}`);
    console.log(`- enqueued: ${result.enqueued}`);
    console.log(`- skipped: ${result.skipped}`);
    console.log(`- failed: ${result.failed}`);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "replay failed";
  console.error(message);
  process.exitCode = 1;
});
