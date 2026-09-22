import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import { SquareCommerceNormalizeService } from "./square-commerce-normalize.service";
import { SquareCommerceReconcileService } from "./square-commerce-reconcile.service";
import {
  parseSquareCommerceBackfillArgs,
  runSquareCommerceBackfill,
  type SquareCommerceBackfillDeps,
} from "./square.commerce.backfill";

async function main(): Promise<void> {
  const plan = parseSquareCommerceBackfillArgs(process.argv.slice(2));
  if (!plan) {
    console.error(
      "Usage: npm run backfill:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  if (plan.dryRun) {
    const result = await runSquareCommerceBackfill(
      unusedDeps(),
      plan,
      console.log,
    );
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const importer = app.get(SquareCommerceImportService);
    const normalizer = app.get(SquareCommerceNormalizeService);
    const reconcilor = app.get(SquareCommerceReconcileService);
    const result = await runSquareCommerceBackfill(
      {
        importWindow: (window) => importer.importWindow(window),
        normalizeWindow: (window) => normalizer.normalizeWindow(window),
        reconcileWindow: (window) => reconcilor.reconcileWindow(window),
      },
      plan,
      console.log,
    );
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function unusedDeps(): SquareCommerceBackfillDeps {
  const refuse = async () => {
    throw new Error("dry-run must not call import, normalize, or reconcile");
  };
  return {
    importWindow: refuse,
    normalizeWindow: refuse,
    reconcileWindow: refuse,
  };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "backfill failed";
  console.error(message);
  process.exitCode = 1;
});
