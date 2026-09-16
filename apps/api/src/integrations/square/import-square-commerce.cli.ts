import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import { describeFarmWindow, parseFarmWindow } from "./square.range";

async function main(): Promise<void> {
  loadEnvFiles();
  const window = parseFarmWindow(process.argv.slice(2));
  if (!window) {
    console.error(
      "Usage: npm run import:square-commerce -- --date YYYY-MM-DD",
    );
    console.error(
      "   or: npm run import:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const importer = app.get(SquareCommerceImportService);
    const result = await importer.importWindow(window);
    console.log("Square commerce import");
    console.log("");
    for (const line of describeFarmWindow(window)) {
      console.log(line);
    }
    console.log(`Orders fetched: ${result.ordersFetched}`);
    console.log(`Payments fetched: ${result.paymentsFetched}`);
    console.log(`Refunds fetched: ${result.refundsFetched}`);
    console.log("Orders selected by closed_at in the farm day.");
    console.log(`Snapshots inserted: ${result.snapshotsInserted}`);
    console.log(`Snapshots unchanged: ${result.snapshotsUnchanged}`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "import failed";
  console.error(message);
  process.exitCode = 1;
});
