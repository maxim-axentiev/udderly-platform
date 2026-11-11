import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { loadEnvFiles } from "../config/load-env";
import {
  parseNamingObjectCommand,
  usageText,
  type NamingObjectCommand,
} from "./naming-object.command";
import {
  NamingObjectService,
  type NamingObjectRecord,
} from "./naming-object.service";

async function main(): Promise<void> {
  loadEnvFiles();
  const command = parseNamingObjectCommand(process.argv.slice(2));
  if (!command) {
    console.error(usageText());
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });

  try {
    const objects = app.get(NamingObjectService);
    const failed = await run(objects, command);
    if (failed) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

async function run(
  objects: NamingObjectService,
  command: NamingObjectCommand,
): Promise<boolean> {
  if (command.action === "list") {
    const rows = await objects.list();
    if (rows.length === 0) {
      console.log("No naming objects.");
      return false;
    }
    for (const row of rows) {
      console.log(formatObject(row));
    }
    return false;
  }

  if (command.action === "add") {
    const row = await objects.create(command);
    console.log(`Created naming object ${row.id}`);
    console.log(formatObject(row));
    return false;
  }

  const result = await objects.update(command);
  if (result.outcome === "not_found") {
    console.error("Naming object was not found.");
    return true;
  }
  if (result.outcome === "price_locked") {
    console.error(
      "Refused: price can change only while the object is available.",
    );
    return true;
  }
  if (result.outcome === "test_object") {
    console.error("Refused: test objects stay unpublished.");
    return true;
  }
  console.log(`Updated naming object ${result.object.id}`);
  console.log(formatObject(result.object));
  return false;
}

function formatObject(row: NamingObjectRecord): string {
  return [
    `id: ${row.id}`,
    `name: ${row.name}`,
    `description: ${row.description}`,
    `price_cents: ${row.priceAmount}`,
    `currency: ${row.currency}`,
    `photo_url: ${row.photoUrl ?? ""}`,
    `published: ${row.publishedAt ? "yes" : "no"}`,
    `test: ${row.isTest ? "yes" : "no"}`,
    `status: ${row.status}`,
  ].join("\n");
}

void main();
