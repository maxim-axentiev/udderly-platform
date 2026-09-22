import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { formatSquareCommerceReconcile } from "./square.commerce.reconcile";
import { SquareCommerceReconcileService } from "./square-commerce-reconcile.service";
import { parseFarmWindow } from "./square.range";

async function main(): Promise<void> {
  loadEnvFiles();
  const window = parseFarmWindow(process.argv.slice(2));
  if (!window) {
    console.error(
      "Usage: npm run reconcile:square-commerce -- --date YYYY-MM-DD",
    );
    console.error(
      "   or: npm run reconcile:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const reconcilor = app.get(SquareCommerceReconcileService);
    const verdict = await reconcilor.reconcileWindow(window);
    console.log(formatSquareCommerceReconcile(verdict));
    if (!verdict.passed) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "reconcile failed";
  console.error(message);
  process.exitCode = 1;
});
