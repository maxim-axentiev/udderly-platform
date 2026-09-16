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
import {
  SQUARE_CATEGORY_ENTITY,
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";

const CAT_A = "SYN-SQ-CAT-A";
const CAT_B = "SYN-SQ-CAT-B";
const ITEM_NAMED = "SYN-SQ-ITEM-NAMED";
const ITEM_DUP_A = "SYN-SQ-ITEM-DUP-A";
const ITEM_DUP_B = "SYN-SQ-ITEM-DUP-B";
const ITEM_MULTI = "SYN-SQ-ITEM-MULTI";
const ITEM_ARCH = "SYN-SQ-ITEM-ARCH";
const ITEM_DEL = "SYN-SQ-ITEM-DEL";
const ITEM_UNC = "SYN-SQ-ITEM-UNC";
const VAR_PARENT = "SYN-SQ-VAR-PARENT";
const VAR_SKU_A = "SYN-SQ-VAR-SKU-A";
const VAR_SKU_B = "SYN-SQ-VAR-SKU-B";
const VAR_NOSKU = "SYN-SQ-VAR-NOSKU";
const VAR_ORPHAN = "SYN-SQ-VAR-ORPHAN";
const ITEM_STALE = "SYN-SQ-ITEM-STALE";

const ALL_EXTERNAL_IDS = [
  CAT_A,
  CAT_B,
  ITEM_NAMED,
  ITEM_DUP_A,
  ITEM_DUP_B,
  ITEM_MULTI,
  ITEM_ARCH,
  ITEM_DEL,
  ITEM_UNC,
  VAR_PARENT,
  VAR_SKU_A,
  VAR_SKU_B,
  VAR_NOSKU,
  VAR_ORPHAN,
  ITEM_STALE,
];

async function main(): Promise<void> {
  loadEnvFiles();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  const database = app.get(DatabaseService);
  const importer = app.get(SquareCatalogImportService);
  const normalizer = app.get(SquareCatalogNormalizeService);

  try {
    await cleanup(database);

    const first = await importer.persistCatalogObjects([
      category(CAT_A, "SYNTHETIC Cheese"),
      category(CAT_B, "SYNTHETIC Ice Cream"),
      item(ITEM_NAMED, "SYNTHETIC Gouda", { categories: [CAT_A] }),
      item(ITEM_DUP_A, "SYNTHETIC Duplicate Name"),
      item(ITEM_DUP_B, "SYNTHETIC Duplicate Name"),
      item(ITEM_MULTI, "SYNTHETIC Multi Cat", {
        categories: [CAT_A, CAT_B],
      }),
      item(ITEM_ARCH, "SYNTHETIC Archived", { archived: true }),
      item(ITEM_DEL, "SYNTHETIC Deleted", { deleted: true }),
      item(ITEM_UNC, "SYNTHETIC Uncategorized"),
      item(VAR_PARENT, "SYNTHETIC Parent"),
      variation(VAR_SKU_A, VAR_PARENT, "Each", "SAME-SKU"),
      variation(VAR_SKU_B, VAR_PARENT, "Box", "SAME-SKU"),
      variation(VAR_NOSKU, VAR_PARENT, "Loose"),
      variation(VAR_ORPHAN, "SYN-SQ-MISSING-PARENT", "Orphan"),
    ]);
    if (first.categoriesFetched !== 2 || first.itemsFetched !== 8) {
      throw new Error("expected synthetic catalog fetch counts");
    }
    if (first.variationsFetched !== 4 || first.snapshotsInserted < 1) {
      throw new Error("expected variation snapshots to be inserted");
    }

    const again = await importer.persistCatalogObjects([
      category(CAT_A, "SYNTHETIC Cheese"),
      category(CAT_B, "SYNTHETIC Ice Cream"),
    ]);
    if (again.snapshotsInserted !== 0 || again.snapshotsUnchanged < 2) {
      throw new Error("exact same catalog import must reuse snapshots");
    }
    console.log("- exact same catalog import does not create duplicate snapshots");

    await normalizer.normalizeLatest();

    const categoryA = await loadCategory(database, CAT_A);
    if (categoryA.name !== "SYNTHETIC Cheese" || categoryA.status !== "active") {
      throw new Error("category A was not created");
    }
    const categoryAAgain = await loadCategory(database, CAT_A);
    if (categoryAAgain.id !== categoryA.id) {
      throw new Error("category normalize is not idempotent");
    }
    console.log("- category create is idempotent");

    const dupA = await loadProduct(database, ITEM_DUP_A);
    const dupB = await loadProduct(database, ITEM_DUP_B);
    if (dupA.name !== dupB.name || dupA.id === dupB.id) {
      throw new Error("duplicate names must stay separate Square identities");
    }
    console.log("- duplicate item names create separate products");

    const named = await loadProduct(database, ITEM_NAMED);
    if (named.status !== "active") {
      throw new Error("item did not create an active product");
    }

    const parent = await loadProduct(database, VAR_PARENT);
    const varA = await loadVariation(database, VAR_SKU_A);
    const varB = await loadVariation(database, VAR_SKU_B);
    const varNoSku = await loadVariation(database, VAR_NOSKU);
    if (varA.productId !== parent.id || varB.productId !== parent.id) {
      throw new Error("variations must link to the exact parent item");
    }
    if (varA.sku !== "SAME-SKU" || varB.sku !== "SAME-SKU" || varA.id === varB.id) {
      throw new Error("matching SKUs must not merge variations");
    }
    if (varNoSku.sku !== null) {
      throw new Error("missing SKU must remain null");
    }
    console.log("- variations use Square ids, nullable SKU, no SKU merge");

    const archived = await loadProduct(database, ITEM_ARCH);
    if (archived.status !== "archived") {
      throw new Error("archived item must remain stored as archived");
    }
    const deleted = await loadProduct(database, ITEM_DEL);
    if (deleted.status !== "deleted") {
      throw new Error("deleted item must be retained with deleted status");
    }
    console.log("- archived and deleted catalog objects are retained");

    const multi = await loadProduct(database, ITEM_MULTI);
    const assignments = await listAssignments(database, multi.id);
    if (assignments.length !== 2) {
      throw new Error("item with two categories should have two assignments");
    }
    const uncategorized = await loadProduct(database, ITEM_UNC);
    const none = await listAssignments(database, uncategorized.id);
    if (none.length !== 0) {
      throw new Error("uncategorized item must not get a fake category");
    }
    console.log("- multi-category and uncategorized items are valid");

    if (await resolvedId(database, SQUARE_ITEM_VARIATION_ENTITY, VAR_ORPHAN)) {
      throw new Error("orphan variation must not create a product_variation");
    }
    console.log("- missing parent item prevents invalid variation");

    await importer.persistCatalogObjects([
      item(ITEM_MULTI, "SYNTHETIC Multi Cat", {
        categories: [CAT_A],
        version: 2,
      }),
    ]);
    await normalizer.normalizeLatest();
    const afterRemoval = await listAssignments(database, multi.id);
    if (afterRemoval.length !== 1) {
      throw new Error("removed category assignment was not dropped");
    }
    const remaining = await loadCategory(database, CAT_B);
    if (!remaining) {
      throw new Error("category B must not be hard-deleted");
    }
    console.log("- removing a category membership drops only that assignment");

    await importer.persistCatalogObjects([
      item(ITEM_STALE, "SYNTHETIC Old Name", { version: 1 }),
    ]);
    await normalizer.normalizeLatest();
    const staleRows = await database.db
      .select({
        id: sourceSnapshots.id,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, SQUARE_ITEM_ENTITY),
          eq(sourceSnapshots.externalId, ITEM_STALE),
        ),
      );
    const oldest = staleRows.sort(
      (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
    )[0];
    if (!oldest) {
      throw new Error("stale snapshot missing");
    }
    await importer.persistCatalogObjects([
      item(ITEM_STALE, "SYNTHETIC New Name", { version: 2 }),
    ]);
    await normalizer.normalizeLatest();
    const staleApply = await normalizer.applySnapshot(oldest.id);
    if (staleApply.outcome !== "skipped_stale") {
      throw new Error("older snapshot must not roll catalog state backward");
    }
    const staleProduct = await loadProduct(database, ITEM_STALE);
    if (staleProduct.name !== "SYNTHETIC New Name") {
      throw new Error("canonical name was rolled back");
    }
    console.log("- older snapshot cannot roll newer canonical state backward");

    const secondNormalize = await normalizer.normalizeLatest();
    if (
      secondNormalize.unresolvedParents < 1 ||
      secondNormalize.products < 1
    ) {
      throw new Error("expected idempotent normalize to keep unresolved parent count");
    }
    const productCount = await countIdentities(
      database,
      SQUARE_ITEM_ENTITY,
      [
        ITEM_NAMED,
        ITEM_DUP_A,
        ITEM_DUP_B,
        ITEM_MULTI,
        ITEM_ARCH,
        ITEM_DEL,
        ITEM_UNC,
        VAR_PARENT,
        ITEM_STALE,
      ],
    );
    if (productCount !== 9) {
      throw new Error("idempotent normalize created extra products");
    }
    console.log("- repeated normalize does not duplicate catalog rows");

    await cleanup(database);
    console.log("");
    console.log("Square catalog tests passed.");
  } finally {
    await app.close();
  }
}

function category(id: string, name: string): Record<string, unknown> {
  return {
    type: "CATEGORY",
    id,
    version: 1,
    is_deleted: false,
    category_data: { name, is_archived: false },
  };
}

function item(
  id: string,
  name: string,
  options: {
    categories?: string[];
    archived?: boolean;
    deleted?: boolean;
    version?: number;
  } = {},
): Record<string, unknown> {
  return {
    type: "ITEM",
    id,
    version: options.version ?? 1,
    is_deleted: options.deleted === true,
    item_data: {
      name,
      is_archived: options.archived === true,
      categories: (options.categories ?? []).map((categoryId) => ({
        id: categoryId,
      })),
    },
  };
}

function variation(
  id: string,
  itemId: string,
  name: string,
  sku?: string,
): Record<string, unknown> {
  return {
    type: "ITEM_VARIATION",
    id,
    version: 1,
    is_deleted: false,
    item_variation_data: {
      item_id: itemId,
      name,
      ...(sku ? { sku } : {}),
    },
  };
}

async function loadCategory(
  database: DatabaseService,
  externalId: string,
): Promise<{ id: string; name: string; status: string }> {
  const id = await resolvedId(database, SQUARE_CATEGORY_ENTITY, externalId);
  if (!id) {
    throw new Error(`missing category ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      status: productCategories.status,
    })
    .from(productCategories)
    .where(eq(productCategories.id, id))
    .limit(1);
  if (!row) {
    throw new Error("category row missing");
  }
  return row;
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
    throw new Error("product row missing");
  }
  return row;
}

async function loadVariation(
  database: DatabaseService,
  externalId: string,
): Promise<{ id: string; productId: string; sku: string | null }> {
  const id = await resolvedId(
    database,
    SQUARE_ITEM_VARIATION_ENTITY,
    externalId,
  );
  if (!id) {
    throw new Error(`missing variation ${externalId}`);
  }
  const [row] = await database.db
    .select({
      id: productVariations.id,
      productId: productVariations.productId,
      sku: productVariations.sku,
    })
    .from(productVariations)
    .where(eq(productVariations.id, id))
    .limit(1);
  if (!row) {
    throw new Error("variation row missing");
  }
  return row;
}

async function listAssignments(
  database: DatabaseService,
  productId: string,
): Promise<string[]> {
  const rows = await database.db
    .select({ categoryId: productCategoryAssignments.categoryId })
    .from(productCategoryAssignments)
    .where(eq(productCategoryAssignments.productId, productId));
  return rows.map((row) => row.categoryId);
}

async function countIdentities(
  database: DatabaseService,
  entityType: string,
  externalIds: string[],
): Promise<number> {
  const rows = await database.db
    .select({ internalEntityId: sourceIdentities.internalEntityId })
    .from(sourceIdentities)
    .where(
      and(
        eq(sourceIdentities.provider, SQUARE_PROVIDER),
        eq(sourceIdentities.entityType, entityType),
        inArray(sourceIdentities.externalId, externalIds),
      ),
    );
  return rows.filter((row) => row.internalEntityId).length;
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
  const categoryIds = identities
    .filter((row) => row.entityType === SQUARE_CATEGORY_ENTITY)
    .map((row) => row.internalEntityId)
    .filter((id): id is string => Boolean(id));

  if (productIds.length > 0) {
    await database.db
      .delete(productCategoryAssignments)
      .where(inArray(productCategoryAssignments.productId, productIds));
  }
  if (categoryIds.length > 0) {
    await database.db
      .delete(productCategoryAssignments)
      .where(inArray(productCategoryAssignments.categoryId, categoryIds));
  }
  if (variationIds.length > 0) {
    await database.db
      .delete(productVariations)
      .where(inArray(productVariations.id, variationIds));
  }
  if (productIds.length > 0) {
    await database.db.delete(products).where(inArray(products.id, productIds));
  }
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
  const message = error instanceof Error ? error.message : "test failed";
  console.error(message);
  process.exitCode = 1;
});
