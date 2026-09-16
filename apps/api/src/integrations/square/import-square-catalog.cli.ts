import { NestFactory } from "@nestjs/core";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { SquareCatalogImportService } from "./square-catalog-import.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const importer = app.get(SquareCatalogImportService);
    const result = await importer.importCatalog();
    console.log("Square catalog import");
    console.log("");
    console.log(`Categories fetched: ${result.categoriesFetched}`);
    console.log(`Items fetched: ${result.itemsFetched}`);
    console.log(`Variations fetched: ${result.variationsFetched}`);
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
