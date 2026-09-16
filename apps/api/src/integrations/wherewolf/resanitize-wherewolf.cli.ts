import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { WherewolfResanitizeService } from "./wherewolf-resanitize.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const service = app.get(WherewolfResanitizeService);
    const result = await service.resanitize();
    console.log("Wherewolf resanitize");
    console.log("");
    console.log(`Scanned: ${result.scanned}`);
    console.log(`Updated: ${result.updated}`);
    console.log(`Deduplicated: ${result.deduplicated}`);
    console.log(`Unchanged: ${result.unchanged}`);
    if (result.skipped > 0) {
      console.log(`Skipped: ${result.skipped}`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "resanitize failed";
  console.error(message);
  process.exitCode = 1;
});
