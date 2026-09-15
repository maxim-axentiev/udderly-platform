import { NestFactory } from "@nestjs/core";
import { and, eq, inArray } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import {
  experienceSourceMappings,
  experiences,
} from "../../database/schema/experiences";
import { FareharborExperienceMapService } from "./fareharbor-experience-map.service";
import { FAREHARBOR_PROVIDER } from "./fareharbor.crypto";
import { FAREHARBOR_ITEM_OBJECT_TYPE } from "./fareharbor.constants";

const ITEM_A = "610001";
const ITEM_B = "610002";
const NAME_A = "SYNTHETIC CLI Miniature Donkey Visits";
const NAME_B = "SYNTHETIC CLI Goat Walk Existing";
const AMBIGUOUS_NAME = "SYNTHETIC CLI Ambiguous Experience";

async function main(): Promise<void> {
  loadEnvFiles();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const database = app.get(DatabaseService);
  const mapper = app.get(FareharborExperienceMapService);

  try {
    await cleanup(database);

    const created = await mapper.mapItem({ itemId: ITEM_A, name: NAME_A });
    if (created.outcome !== "created" || !created.createdExperience) {
      throw new Error("expected new canonical experience and mapping");
    }
    const experienceA = created.experienceId;
    await assertMapping(database, ITEM_A, experienceA);
    console.log("- created canonical experience and mapped FareHarbor item");

    const existing = await database.db
      .insert(experiences)
      .values({ name: NAME_B, status: "active" })
      .returning({ id: experiences.id });
    const experienceB = existing[0]?.id;
    if (!experienceB) {
      throw new Error("failed to seed existing experience");
    }

    const mappedExisting = await mapper.mapItem({
      itemId: ITEM_B,
      experienceId: experienceB,
    });
    if (
      mappedExisting.outcome !== "created" ||
      mappedExisting.createdExperience ||
      mappedExisting.experienceId !== experienceB
    ) {
      throw new Error("expected mapping onto an existing experience");
    }
    await assertMapping(database, ITEM_B, experienceB);
    console.log("- mapped FareHarbor item onto an existing experience");

    const again = await mapper.mapItem({ itemId: ITEM_A, name: NAME_A });
    if (again.outcome !== "unchanged" || again.experienceId !== experienceA) {
      throw new Error("expected idempotent mapping rerun");
    }
    const againById = await mapper.mapItem({
      itemId: ITEM_B,
      experienceId: experienceB,
    });
    if (
      againById.outcome !== "unchanged" ||
      againById.experienceId !== experienceB
    ) {
      throw new Error("expected idempotent mapping by experience id");
    }
    console.log("- rerunning the same mapping is idempotent");

    const conflict = await mapper.mapItem({
      itemId: ITEM_A,
      experienceId: experienceB,
    });
    if (
      conflict.outcome !== "conflict" ||
      conflict.mappedExperienceId !== experienceA
    ) {
      throw new Error("expected conflicting remap to be refused");
    }
    await assertMapping(database, ITEM_A, experienceA);
    console.log("- refused mapping an item onto a different experience");

    const missing = await mapper.mapItem({
      itemId: ITEM_B,
      experienceId: "00000000-0000-4000-a000-000000000099",
    });
    if (
      missing.outcome !== "experience_not_found" ||
      missing.experienceId !== "00000000-0000-4000-a000-000000000099"
    ) {
      throw new Error("expected invalid experience id to be refused");
    }
    await assertMapping(database, ITEM_B, experienceB);
    console.log("- refused mapping to a missing canonical experience");

    await database.db.insert(experiences).values([
      { name: AMBIGUOUS_NAME, status: "active" },
      { name: AMBIGUOUS_NAME, status: "active" },
    ]);
    const ambiguous = await mapper.mapItem({
      itemId: "610003",
      name: AMBIGUOUS_NAME,
    });
    if (ambiguous.outcome !== "ambiguous_name" || ambiguous.matchCount !== 2) {
      throw new Error("expected exact-name collision to stop without guessing");
    }
    const stray = await database.db
      .select({ id: experienceSourceMappings.id })
      .from(experienceSourceMappings)
      .where(
        and(
          eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
          eq(experienceSourceMappings.externalId, "610003"),
        ),
      );
    if (stray.length !== 0) {
      throw new Error("ambiguous name must not write a mapping");
    }
    console.log("- refused to guess among duplicate exact experience names");

    await cleanup(database);
    console.log("");
    console.log("FareHarbor experience mapping tests passed.");
  } finally {
    await app.close();
  }
}

async function assertMapping(
  database: DatabaseService,
  itemId: string,
  experienceId: string,
): Promise<void> {
  const rows = await database.db
    .select({
      experienceId: experienceSourceMappings.experienceId,
      externalLabel: experienceSourceMappings.externalLabel,
      provider: experienceSourceMappings.provider,
      providerObjectType: experienceSourceMappings.providerObjectType,
    })
    .from(experienceSourceMappings)
    .where(
      and(
        eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
        eq(
          experienceSourceMappings.providerObjectType,
          FAREHARBOR_ITEM_OBJECT_TYPE,
        ),
        eq(experienceSourceMappings.externalId, itemId),
      ),
    );

  if (rows.length !== 1) {
    throw new Error(`expected one mapping for item ${itemId}`);
  }
  if (rows[0]?.experienceId !== experienceId) {
    throw new Error("mapping experience id mismatch");
  }
  if (rows[0]?.provider !== "fareharbor" || rows[0]?.providerObjectType !== "item") {
    throw new Error("mapping provider fields mismatch");
  }
  if (rows[0]?.externalLabel !== null) {
    throw new Error("mapping CLI must leave external_label null");
  }
}

async function cleanup(database: DatabaseService): Promise<void> {
  const itemIds = [ITEM_A, ITEM_B, "610003"];
  await database.db
    .delete(experienceSourceMappings)
    .where(
      and(
        eq(experienceSourceMappings.provider, FAREHARBOR_PROVIDER),
        eq(
          experienceSourceMappings.providerObjectType,
          FAREHARBOR_ITEM_OBJECT_TYPE,
        ),
        inArray(experienceSourceMappings.externalId, itemIds),
      ),
    );

  await database.db
    .delete(experiences)
    .where(
      inArray(experiences.name, [NAME_A, NAME_B, AMBIGUOUS_NAME]),
    );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
