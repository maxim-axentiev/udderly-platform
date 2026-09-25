import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquareCommerceNormalizeService } from "./square-commerce-normalize.service";
import { describeFarmWindow, parseFarmWindow } from "./square.range";

async function main(): Promise<void> {
  loadEnvFiles();
  const window = parseFarmWindow(process.argv.slice(2));
  if (!window) {
    console.error(
      "Usage: npm run normalize:square-commerce -- --date YYYY-MM-DD",
    );
    console.error(
      "   or: npm run normalize:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const normalizer = app.get(SquareCommerceNormalizeService);
    const result = await normalizer.normalizeWindow(window);
    console.log("Square commerce normalization");
    console.log("");
    for (const line of describeFarmWindow(window)) {
      console.log(line);
    }
    console.log(`Sales: ${result.sales}`);
    console.log(`Line items: ${result.lineItems}`);
    console.log(`Custom/non-catalog lines: ${result.customNonCatalogLines}`);
    console.log(`Unresolved catalog lines: ${result.unresolvedCatalogLines}`);
    console.log(`Payments: ${result.payments}`);
    console.log(`Refunds: ${result.refunds}`);
    console.log(`Return-only orders skipped: ${result.returnOnlyOrdersSkipped}`);
    console.log(
      `Return-adjustment non-sales skipped: ${result.returnAdjustmentNonSalesSkipped}`,
    );
    console.log(`Invalid order money skipped: ${result.invalidOrderMoneySkipped}`);
    console.log(`Unresolved payments: ${result.unresolvedPayments}`);
    console.log(`Unresolved refunds: ${result.unresolvedRefunds}`);
    console.log(`Dependency orders applied: ${result.dependencyOrdersApplied}`);
    console.log(
      `Net fee credits not representable: ${result.invalidProcessingFees}`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "normalize failed";
  console.error(message);
  process.exitCode = 1;
});
