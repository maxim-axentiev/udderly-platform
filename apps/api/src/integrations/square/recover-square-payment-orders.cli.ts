import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquarePaymentOrderRecoveryService } from "./square-payment-order-recovery.service";
import { parseFarmWindow } from "./square.range";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const window = parseFarmWindow(argv);
  const dryRun = argv.includes("--dry-run");
  if (!window) {
    console.error(
      "Usage: npm run recover:square-payment-orders -- --date YYYY-MM-DD [--dry-run]",
    );
    console.error(
      "   or: npm run recover:square-payment-orders -- --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const recovery = app.get(SquarePaymentOrderRecoveryService);
    const result = await recovery.recoverWindow(window, { dryRun });
    console.log(result.report);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "recovery failed";
  console.error(message);
  process.exitCode = 1;
});
