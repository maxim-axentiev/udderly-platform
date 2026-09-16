import { and, eq, sql } from "drizzle-orm";
import { Injectable } from "@nestjs/common";
import type { AppDatabase } from "../../database/database.service";
import {
  productCategories,
  productCategoryAssignments,
  products,
  productVariations,
} from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { squareCatalogStatus } from "./square.catalog.status";
import {
  INTERNAL_PRODUCT,
  INTERNAL_PRODUCT_CATEGORY,
  INTERNAL_PRODUCT_VARIATION,
  SQUARE_CATEGORY_ENTITY,
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";

export type SquareCatalogDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export type SquareCatalogApplyResult =
  | { outcome: "applied"; kind: "category" | "product" | "variation" }
  | { outcome: "skipped_stale" }
  | { outcome: "unresolved_parent"; itemId?: string }
  | { outcome: "skipped"; reason: "invalid_payload" | "not_found" };

@Injectable()
export class SquareCatalogNormalizer {
  async applySnapshot(
    db: SquareCatalogDb,
    snapshotId: string,
  ): Promise<SquareCatalogApplyResult> {
    const [snapshot] = await db
      .select({
        id: sourceSnapshots.id,
        entityType: sourceSnapshots.entityType,
        externalId: sourceSnapshots.externalId,
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, snapshotId))
      .limit(1);

    if (!snapshot) {
      return { outcome: "skipped", reason: "not_found" };
    }

    if (await this.hasNewerSnapshot(db, snapshot)) {
      return { outcome: "skipped_stale" };
    }

    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`sq-cat-${snapshot.entityType}-${snapshot.externalId}`}, 0))`,
    );

    if (snapshot.entityType === SQUARE_CATEGORY_ENTITY) {
      return this.applyCategory(db, snapshot);
    }
    if (snapshot.entityType === SQUARE_ITEM_ENTITY) {
      return this.applyItem(db, snapshot);
    }
    if (snapshot.entityType === SQUARE_ITEM_VARIATION_ENTITY) {
      return this.applyVariation(db, snapshot);
    }
    return { outcome: "skipped", reason: "invalid_payload" };
  }

  private async hasNewerSnapshot(
    db: SquareCatalogDb,
    snapshot: {
      id: string;
      entityType: string;
      externalId: string;
      observedAt: Date;
      payload: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const rows = await db
      .select({
        id: sourceSnapshots.id,
        observedAt: sourceSnapshots.observedAt,
        payload: sourceSnapshots.payload,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, snapshot.entityType),
          eq(sourceSnapshots.externalId, snapshot.externalId),
        ),
      );

    const currentVersion = numberValue(snapshot.payload.version) ?? 0;
    for (const row of rows) {
      if (row.id === snapshot.id) {
        continue;
      }
      if (row.observedAt.getTime() > snapshot.observedAt.getTime()) {
        return true;
      }
      if (row.observedAt.getTime() === snapshot.observedAt.getTime()) {
        const otherVersion = numberValue(row.payload.version) ?? 0;
        if (otherVersion > currentVersion) {
          return true;
        }
      }
    }
    return false;
  }

  private async applyCategory(
    db: SquareCatalogDb,
    snapshot: {
      externalId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<SquareCatalogApplyResult> {
    const name = stringValue(snapshot.payload.name) ?? "";
    const status = squareCatalogStatus({
      isDeleted: snapshot.payload.is_deleted === true,
      isArchived: snapshot.payload.is_archived === true,
    });
    const existingId = await this.findResolved(
      db,
      SQUARE_CATEGORY_ENTITY,
      snapshot.externalId,
      INTERNAL_PRODUCT_CATEGORY,
    );

    if (existingId) {
      await db
        .update(productCategories)
        .set({ name, status, updatedAt: new Date() })
        .where(eq(productCategories.id, existingId));
      await this.upsertIdentity(
        db,
        SQUARE_CATEGORY_ENTITY,
        snapshot.externalId,
        INTERNAL_PRODUCT_CATEGORY,
        existingId,
      );
      return { outcome: "applied", kind: "category" };
    }

    const inserted = await db
      .insert(productCategories)
      .values({ name, status })
      .returning({ id: productCategories.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error("product_category_insert_failed");
    }
    await this.upsertIdentity(
      db,
      SQUARE_CATEGORY_ENTITY,
      snapshot.externalId,
      INTERNAL_PRODUCT_CATEGORY,
      id,
    );
    return { outcome: "applied", kind: "category" };
  }

  private async applyItem(
    db: SquareCatalogDb,
    snapshot: {
      externalId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<SquareCatalogApplyResult> {
    const name = stringValue(snapshot.payload.name) ?? "";
    const status = squareCatalogStatus({
      isDeleted: snapshot.payload.is_deleted === true,
      isArchived: snapshot.payload.is_archived === true,
    });
    let productId = await this.findResolved(
      db,
      SQUARE_ITEM_ENTITY,
      snapshot.externalId,
      INTERNAL_PRODUCT,
    );

    if (productId) {
      await db
        .update(products)
        .set({ name, status, updatedAt: new Date() })
        .where(eq(products.id, productId));
    } else {
      const inserted = await db
        .insert(products)
        .values({ name, status })
        .returning({ id: products.id });
      productId = inserted[0]?.id;
      if (!productId) {
        throw new Error("product_insert_failed");
      }
    }

    await this.upsertIdentity(
      db,
      SQUARE_ITEM_ENTITY,
      snapshot.externalId,
      INTERNAL_PRODUCT,
      productId,
    );
    await this.syncAssignments(db, productId, categoryIdsFrom(snapshot.payload));
    return { outcome: "applied", kind: "product" };
  }

  private async applyVariation(
    db: SquareCatalogDb,
    snapshot: {
      externalId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<SquareCatalogApplyResult> {
    const itemId = stringValue(snapshot.payload.item_id);
    if (!itemId) {
      return { outcome: "unresolved_parent" };
    }

    const productId = await this.findResolved(
      db,
      SQUARE_ITEM_ENTITY,
      itemId,
      INTERNAL_PRODUCT,
    );
    if (!productId) {
      return { outcome: "unresolved_parent", itemId };
    }

    const name = stringValue(snapshot.payload.name);
    const sku = stringValue(snapshot.payload.sku);
    const status = squareCatalogStatus({
      isDeleted: snapshot.payload.is_deleted === true,
      isArchived: snapshot.payload.is_archived === true,
    });

    const existingId = await this.findResolved(
      db,
      SQUARE_ITEM_VARIATION_ENTITY,
      snapshot.externalId,
      INTERNAL_PRODUCT_VARIATION,
    );

    if (existingId) {
      await db
        .update(productVariations)
        .set({
          productId,
          name,
          sku,
          status,
          updatedAt: new Date(),
        })
        .where(eq(productVariations.id, existingId));
      await this.upsertIdentity(
        db,
        SQUARE_ITEM_VARIATION_ENTITY,
        snapshot.externalId,
        INTERNAL_PRODUCT_VARIATION,
        existingId,
      );
      return { outcome: "applied", kind: "variation" };
    }

    const inserted = await db
      .insert(productVariations)
      .values({ productId, name, sku, status })
      .returning({ id: productVariations.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error("product_variation_insert_failed");
    }
    await this.upsertIdentity(
      db,
      SQUARE_ITEM_VARIATION_ENTITY,
      snapshot.externalId,
      INTERNAL_PRODUCT_VARIATION,
      id,
    );
    return { outcome: "applied", kind: "variation" };
  }

  private async syncAssignments(
    db: SquareCatalogDb,
    productId: string,
    squareCategoryIds: string[],
  ): Promise<void> {
    const desired = new Set<string>();
    for (const squareId of squareCategoryIds) {
      const categoryId = await this.findResolved(
        db,
        SQUARE_CATEGORY_ENTITY,
        squareId,
        INTERNAL_PRODUCT_CATEGORY,
      );
      if (categoryId) {
        desired.add(categoryId);
      }
    }

    const existing = await db
      .select({
        categoryId: productCategoryAssignments.categoryId,
      })
      .from(productCategoryAssignments)
      .where(eq(productCategoryAssignments.productId, productId));

    for (const row of existing) {
      if (!desired.has(row.categoryId)) {
        await db
          .delete(productCategoryAssignments)
          .where(
            and(
              eq(productCategoryAssignments.productId, productId),
              eq(productCategoryAssignments.categoryId, row.categoryId),
            ),
          );
      }
    }

    const existingIds = new Set(existing.map((row) => row.categoryId));
    for (const categoryId of desired) {
      if (existingIds.has(categoryId)) {
        continue;
      }
      await db.insert(productCategoryAssignments).values({
        productId,
        categoryId,
      });
    }
  }

  private async findResolved(
    db: SquareCatalogDb,
    entityType: string,
    externalId: string,
    internalEntityType: string,
  ): Promise<string | undefined> {
    const rows = await db
      .select({
        internalEntityId: sourceIdentities.internalEntityId,
        internalEntityType: sourceIdentities.internalEntityType,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (
      row?.internalEntityType === internalEntityType &&
      row.internalEntityId
    ) {
      return row.internalEntityId;
    }
    return undefined;
  }

  private async upsertIdentity(
    db: SquareCatalogDb,
    entityType: string,
    externalId: string,
    internalEntityType: string,
    internalEntityId: string,
  ): Promise<void> {
    const rows = await db
      .select({
        id: sourceIdentities.id,
        internalEntityId: sourceIdentities.internalEntityId,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);

    if (rows[0]) {
      if (
        rows[0].internalEntityId &&
        rows[0].internalEntityId !== internalEntityId
      ) {
        throw new Error("square_catalog_identity_conflict");
      }
      await db
        .update(sourceIdentities)
        .set({
          internalEntityType,
          internalEntityId,
          updatedAt: new Date(),
        })
        .where(eq(sourceIdentities.id, rows[0].id));
      return;
    }

    await db.insert(sourceIdentities).values({
      provider: SQUARE_PROVIDER,
      entityType,
      externalId,
      internalEntityType,
      internalEntityId,
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function categoryIdsFrom(payload: Record<string, unknown>): string[] {
  const value = payload.category_ids;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}
