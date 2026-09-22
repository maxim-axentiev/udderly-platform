import { NestFactory } from "@nestjs/core";
import { and, eq, inArray } from "drizzle-orm";
import { AppModule } from "../../app.module";
import { loadEnvFiles } from "../../config/load-env";
import { DatabaseService } from "../../database/database.service";
import {
  productCategories,
  productCategoryAssignments,
  products,
  productVariations,
} from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { SquareCatalogImportService } from "./square-catalog-import.service";
import { SquareCatalogNormalizeService } from "./square-catalog-normalize.service";
import { SquareCatalogRecoveryService } from "./square-catalog-recovery.service";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import {
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";

const ORDER_A = "SYN-SQ-REC-ORDER-A";
const VAR_MISSING = "SYN-SQ-REC-VAR-MISSING";
const VAR_MISSING_B = "SYN-SQ-REC-VAR-MISSING-B";
const VAR_OK = "SYN-SQ-REC-VAR-OK";
const VAR_NOVER = "SYN-SQ-REC-VAR-NOVER";
const VAR_TWO_VER = "SYN-SQ-REC-VAR-TWO";
const ITEM_PARENT = "SYN-SQ-REC-ITEM-PARENT";
const ITEM_EXISTING = "SYN-SQ-REC-ITEM-EXIST";
const VAR_EXISTING = "SYN-SQ-REC-VAR-EXIST";
const ITEM_STALE = "SYN-SQ-REC-ITEM-STALE";
const VAR_STALE = "SYN-SQ-REC-VAR-STALE";
const ITEM_NEW = "SYN-SQ-REC-ITEM-NEW";
const VAR_NEW = "SYN-SQ-REC-VAR-NEW";
const CLOSED = "2026-06-15T16:00:00.000Z";
const WINDOW = { from: "2026-06-01", to: "2026-06-30" } as const;

const ALL_EXTERNAL_IDS = [
  ORDER_A,
  VAR_MISSING,
  VAR_MISSING_B,
  VAR_OK,
  VAR_NOVER,
  VAR_TWO_VER,
  ITEM_PARENT,
  ITEM_EXISTING,
  VAR_EXISTING,
  ITEM_STALE,
  VAR_STALE,
  ITEM_NEW,
  VAR_NEW,
];

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const database = app.get(DatabaseService);
  const commerce = app.get(SquareCommerceImportService);
  const catalog = app.get(SquareCatalogImportService);
  const catalogNorm = app.get(SquareCatalogNormalizeService);
  const recovery = app.get(SquareCatalogRecoveryService);

  try {
    await cleanup(database);

    await catalog.persistCatalogObjects([
      item(ITEM_EXISTING, "Current Parent", { version: 40 }),
      variation(VAR_OK, ITEM_EXISTING, "Each", 40),
      variation(VAR_EXISTING, ITEM_EXISTING, "Box", 40),
    ]);
    await catalogNorm.normalizeLatest();

    await commerce.persistCommerceObjects({
      orders: [
        order(ORDER_A, [
          line("L1", VAR_MISSING, 11),
          line("L2", VAR_MISSING, 11),
          line("L3", VAR_MISSING_B, 12),
          line("L4", VAR_OK, 40),
          line("L5", VAR_NOVER),
          line("L6", VAR_TWO_VER, 10),
          line("L7", VAR_TWO_VER, 20),
        ]),
      ],
    });

    const discovery = await recovery.discoverWindow(WINDOW);
    if (discovery.unresolvedSaleLines !== 5) {
      throw new Error("expected five recoverable unresolved sale lines");
    }
    if (discovery.distinctObjects !== 3) {
      throw new Error("expected three distinct unresolved catalog objects");
    }
    if (discovery.pairs.length !== 4) {
      throw new Error("duplicate object/version must collapse; two versions stay two pairs");
    }
    console.log("- discovery counts unresolved lines and object/version pairs");

    const snapshotsBeforeDry = await countSnapshots(database);
    const dry = await recovery.recoverWindow(WINDOW, { dryRun: true });
    if (!dry.dryRun || !dry.report.includes("Dry run only")) {
      throw new Error("dry-run must not retrieve or write");
    }
    if (dry.report.includes(VAR_MISSING) || dry.report.includes("@")) {
      throw new Error("dry-run report must not include ids or emails");
    }
    if ((await countSnapshots(database)) !== snapshotsBeforeDry) {
      throw new Error("dry-run must not insert snapshots");
    }
    console.log("- dry-run makes no API calls or writes");

    const first = await recovery.persistRetrieved(discovery.pairs, {
      objects: [
        variation(VAR_MISSING, ITEM_PARENT, "Historical Each", 11, {
          deleted: true,
        }),
        variation(VAR_MISSING_B, ITEM_EXISTING, "Historical Other", 12),
        variation(VAR_TWO_VER, ITEM_PARENT, "Two Ver", 20),
        item(ITEM_EXISTING, "Should Not Win", { version: 5 }),
      ],
      relatedObjects: [
        item(ITEM_PARENT, "Recovered Parent", { version: 11 }),
      ],
    });
    if (first.historicalVariationsReturned < 1 || first.relatedItemsReturned < 1) {
      throw new Error("historical variation and related parent must persist");
    }
    if (first.snapshotsInserted < 1) {
      throw new Error("recovery must insert historical snapshots");
    }
    console.log("- historical variation and related parent snapshots are stored");

    await catalogNorm.normalizeLatest();
    const parent = await loadProduct(database, ITEM_PARENT);
    if (!parent) {
      throw new Error("missing parent must be recovered from related item");
    }
    if (parent.status === "active") {
      throw new Error("historical parent must not be claimed currently active");
    }
    const recoveredVar = await loadVariation(database, VAR_MISSING);
    if (!recoveredVar || recoveredVar.status !== "deleted") {
      throw new Error("explicit is_deleted must be preserved");
    }
    if (!(await resolvedId(database, SQUARE_ITEM_VARIATION_ENTITY, VAR_MISSING))) {
      throw new Error("missing historical variation must become resolvable");
    }
    const existingParent = await loadProduct(database, ITEM_EXISTING);
    if (existingParent.name !== "Current Parent") {
      throw new Error("existing canonical parent must be reused and not rolled back");
    }
    console.log("- parent reuse, missing parent recovery, and resolvable variation");

    const again = await recovery.persistRetrieved(discovery.pairs, {
      objects: [
        variation(VAR_MISSING, ITEM_PARENT, "Historical Each", 11, {
          deleted: true,
        }),
        variation(VAR_MISSING_B, ITEM_EXISTING, "Historical Other", 12),
        variation(VAR_TWO_VER, ITEM_PARENT, "Two Ver", 20),
        item(ITEM_EXISTING, "Should Not Win", { version: 5 }),
      ],
      relatedObjects: [item(ITEM_PARENT, "Recovered Parent", { version: 11 })],
    });
    if (again.snapshotsInserted !== 0 || again.snapshotsUnchanged < 1) {
      throw new Error("repeated recovery must be hash-idempotent");
    }
    console.log("- repeated recovery is idempotent");

    await catalog.persistCatalogObjects([
      item(ITEM_STALE, "Current Item Name", { version: 8 }),
      variation(VAR_STALE, ITEM_STALE, "Current Var Name", 8),
    ]);
    await catalogNorm.normalizeLatest();
    await catalog.persistCatalogObjects(
      [
        item(ITEM_STALE, "Old Item Name", { version: 3 }),
        variation(VAR_STALE, ITEM_STALE, "Old Var Name", 3),
      ],
      { expandNestedVariations: false, historicalRecovery: true },
    );
    await catalogNorm.normalizeLatest();
    const staleItem = await loadProduct(database, ITEM_STALE);
    const staleVar = await loadVariation(database, VAR_STALE);
    if (staleItem.name !== "Current Item Name") {
      throw new Error("older recovered parent cannot roll newer canonical parent backward");
    }
    if (staleVar.name !== "Current Var Name") {
      throw new Error("older recovered variation cannot roll newer canonical variation backward");
    }
    console.log("- older recovered catalog cannot roll newer canonical state backward");

    await catalog.persistCatalogObjects(
      [
        item(ITEM_NEW, "Only Historical Item", { version: 2 }),
        variation(VAR_NEW, ITEM_NEW, "Only Historical Var", 2),
      ],
      { expandNestedVariations: false, historicalRecovery: true },
    );
    await catalogNorm.normalizeLatest();
    if (!(await resolvedId(database, SQUARE_ITEM_VARIATION_ENTITY, VAR_NEW))) {
      throw new Error("genuinely missing historical variation must be created");
    }
    const onlyHist = await loadVariation(database, VAR_NEW);
    if (onlyHist.status === "active") {
      throw new Error("historical-only variation must not be marked currently active");
    }
    console.log("- missing historical variation can become canonical");

    await cleanup(database);
    console.log("");
    console.log("Square catalog recovery tests passed.");
  } finally {
    await app.close();
  }
}

function money(amount: number): { amount: number; currency: string } {
  return { amount, currency: "CAD" };
}

function line(
  uid: string,
  catalogObjectId: string,
  catalogVersion?: number,
): Record<string, unknown> {
  return {
    uid,
    name: "Line",
    catalog_object_id: catalogObjectId,
    ...(catalogVersion === undefined ? {} : { catalog_version: catalogVersion }),
    quantity: "1",
    total_money: money(100),
  };
}

function order(
  id: string,
  lines: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    id,
    location_id: "L1",
    state: "COMPLETED",
    created_at: CLOSED,
    updated_at: CLOSED,
    closed_at: CLOSED,
    version: 1,
    total_money: money(100),
    line_items: lines,
  };
}

function item(
  id: string,
  name: string,
  options: { version?: number; deleted?: boolean } = {},
): Record<string, unknown> {
  return {
    type: "ITEM",
    id,
    version: options.version ?? 1,
    is_deleted: options.deleted === true,
    item_data: { name, is_archived: false },
  };
}

function variation(
  id: string,
  itemId: string,
  name: string,
  version = 1,
  options: { deleted?: boolean } = {},
): Record<string, unknown> {
  return {
    type: "ITEM_VARIATION",
    id,
    version,
    is_deleted: options.deleted === true,
    item_variation_data: { item_id: itemId, name },
  };
}

async function loadProduct(
  database: DatabaseService,
  externalId: string,
): Promise<{ id: string; name: string; status: string }> {
  const id = await resolvedId(database, SQUARE_ITEM_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing product ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: products.id,
      name: products.name,
      status: products.status,
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!row) {
    throw new Error(`missing product row ${externalId}`);
  }
  return row;
}

async function loadVariation(
  database: DatabaseService,
  externalId: string,
): Promise<{ id: string; name: string | null; status: string }> {
  const id = await resolvedId(database, SQUARE_ITEM_VARIATION_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing variation ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: productVariations.id,
      name: productVariations.name,
      status: productVariations.status,
    })
    .from(productVariations)
    .where(eq(productVariations.id, id))
    .limit(1);
  if (!row) {
    throw new Error(`missing variation row ${externalId}`);
  }
  return row;
}

async function resolvedId(
  database: DatabaseService,
  entityType: string,
  externalId: string,
): Promise<string | undefined> {
  const rows = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        eq(sourceIdentities.entityType, entityType),
        eq(sourceIdentities.externalId, externalId),
      ),
    )
    .limit(1);
  return rows[0]?.internalEntityId ?? undefined;
}

async function countSnapshots(database: DatabaseService): Promise<number> {
  const rows = await database.db
    .select({ id: sourceSnapshots.id })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, SQUARE_PROVIDER),
        inArray(sourceSnapshots.externalId, ALL_EXTERNAL_IDS),
      ),
    );
  return rows.length;
}

async function cleanup(database: DatabaseService): Promise<void> {
  const identities = await database.db
    .select({
      entityType: sourceIdentities.entityType,
      internalEntityId: sourceIdentities.internalEntityId,
    })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        inArray(sourceIdentities.externalId, ALL_EXTERNAL_IDS),
      ),
    );

  const productIds = identities
    .filter((row) => row.entityType === SQUARE_ITEM_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  const variationIds = identities
    .filter((row) => row.entityType === SQUARE_ITEM_VARIATION_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  if (productIds.length > 0) {
    await database.db
      .delete(productCategoryAssignments)
      .where(inArray(productCategoryAssignments.productId, productIds));
  }
  if (variationIds.length > 0) {
    await database.db
      .delete(productVariations)
      .where(inArray(productVariations.id, variationIds));
  }
  if (productIds.length > 0) {
    await database.db.delete(products).where(inArray(products.id, productIds));
  }
  const categoryIds = identities
    .filter((row) => row.entityType === "category")
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));
  if (categoryIds.length > 0) {
    await database.db
      .delete(productCategories)
      .where(inArray(productCategories.id, categoryIds));
  }

  await database.db
    .delete(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        inArray(sourceIdentities.externalId, ALL_EXTERNAL_IDS),
      ),
    );
  await database.db
    .delete(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.provider, SQUARE_PROVIDER),
        inArray(sourceSnapshots.externalId, ALL_EXTERNAL_IDS),
      ),
    );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "recovery tests failed";
  console.error(message);
  process.exitCode = 1;
});
