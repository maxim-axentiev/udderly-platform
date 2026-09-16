import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquareCatalogNormalizeService } from "./square-catalog-normalize.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const normalizer = app.get(SquareCatalogNormalizeService);
    const result = await normalizer.normalizeLatest();
    console.log("Square catalog normalization");
    console.log("");
    console.log(`Categories: ${result.categories}`);
    console.log(`Products: ${result.products}`);
    console.log(`Variations: ${result.variations}`);
    console.log(`Category assignments: ${result.categoryAssignments}`);
    console.log(`Archived products: ${result.archivedProducts}`);
    console.log(`Unresolved parents: ${result.unresolvedParents}`);
    console.log(`Unresolved categories: ${result.unresolvedCategories}`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "normalize failed";
  console.error(message);
  process.exitCode = 1;
});
