import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { productCategoryAssignments } from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  SQUARE_CATEGORY_ENTITY,
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";
import { SquareCatalogNormalizer } from "./square-catalog-normalizer";

export type SquareCatalogNormalizeSummary = {
  categories: number;
  products: number;
  variations: number;
  categoryAssignments: number;
  archivedProducts: number;
  unresolvedParents: number;
  unresolvedCategories: number;
  skippedStale: number;
};

type LatestSnapshot = {
  id: string;
  externalId: string;
  payload: Record<string, unknown>;
  observedAt: Date;
};

@Injectable()
export class SquareCatalogNormalizeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SquareCatalogNormalizer)
    private readonly normalizer: SquareCatalogNormalizer,
  ) {}

  async applySnapshot(snapshotId: string): Promise<
    Awaited<ReturnType<SquareCatalogNormalizer["applySnapshot"]>>
  > {
    return this.database.db.transaction(async (tx) => {
      return this.normalizer.applySnapshot(tx, snapshotId);
    });
  }

  async normalizeLatest(): Promise<SquareCatalogNormalizeSummary> {
    const categories = await this.latestSnapshots(SQUARE_CATEGORY_ENTITY);
    const items = await this.latestSnapshots(SQUARE_ITEM_ENTITY);
    const variations = await this.latestSnapshots(SQUARE_ITEM_VARIATION_ENTITY);

    const summary: SquareCatalogNormalizeSummary = {
      categories: 0,
      products: 0,
      variations: 0,
      categoryAssignments: 0,
      archivedProducts: 0,
      unresolvedParents: 0,
      unresolvedCategories: 0,
      skippedStale: 0,
    };

    for (const snapshot of categories) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, snapshot.id);
      });
      if (result.outcome === "applied") {
        summary.categories += 1;
      } else if (result.outcome === "skipped_stale") {
        summary.skippedStale += 1;
      }
    }

    const variationsByItem = new Map<string, LatestSnapshot[]>();
    const leftover: LatestSnapshot[] = [];
    for (const variation of variations) {
      const itemId =
        typeof variation.payload.item_id === "string"
          ? variation.payload.item_id
          : undefined;
      if (!itemId) {
        leftover.push(variation);
        continue;
      }
      const list = variationsByItem.get(itemId) ?? [];
      list.push(variation);
      variationsByItem.set(itemId, list);
    }

    for (const item of items) {
      const childVariations = variationsByItem.get(item.externalId) ?? [];
      variationsByItem.delete(item.externalId);

      const itemResult = await this.database.db.transaction(async (tx) => {
        const applied = await this.normalizer.applySnapshot(tx, item.id);
        if (applied.outcome !== "applied") {
          return { item: applied, variations: [] as typeof applied[] };
        }
        const variationResults = [];
        for (const variation of childVariations) {
          variationResults.push(
            await this.normalizer.applySnapshot(tx, variation.id),
          );
        }
        return { item: applied, variations: variationResults };
      });

      if (itemResult.item.outcome === "applied") {
        summary.products += 1;
        if (item.payload.is_archived === true && item.payload.is_deleted !== true) {
          summary.archivedProducts += 1;
        }
        summary.unresolvedCategories += await this.countUnresolvedCategories(
          item.payload,
        );
      } else if (itemResult.item.outcome === "skipped_stale") {
        summary.skippedStale += 1;
        leftover.push(...childVariations);
      } else {
        leftover.push(...childVariations);
      }

      for (const variationResult of itemResult.variations) {
        if (variationResult.outcome === "applied") {
          summary.variations += 1;
        } else if (variationResult.outcome === "unresolved_parent") {
          summary.unresolvedParents += 1;
        } else if (variationResult.outcome === "skipped_stale") {
          summary.skippedStale += 1;
        }
      }
    }

    leftover.push(...[...variationsByItem.values()].flat());
    for (const variation of leftover) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, variation.id);
      });
      if (result.outcome === "applied") {
        summary.variations += 1;
      } else if (result.outcome === "unresolved_parent") {
        summary.unresolvedParents += 1;
      } else if (result.outcome === "skipped_stale") {
        summary.skippedStale += 1;
      }
    }

    summary.categoryAssignments = await this.countAssignments();
    return summary;
  }

  private async countUnresolvedCategories(
    payload: Record<string, unknown>,
  ): Promise<number> {
    const ids = Array.isArray(payload.category_ids)
      ? payload.category_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];
    let unresolved = 0;
    for (const id of ids) {
      const rows = await this.database.db
        .select({ internalEntityId: sourceIdentities.internalEntityId })
        .from(sourceIdentities)
        .where(
          and(
            eq(sourceIdentities.provider, SQUARE_PROVIDER),
            eq(sourceIdentities.entityType, SQUARE_CATEGORY_ENTITY),
            eq(sourceIdentities.externalId, id),
          ),
        )
        .limit(1);
      if (
        !rows[0]?.internalEntityId
      ) {
        unresolved += 1;
      }
    }
    return unresolved;
  }

  private async countAssignments(): Promise<number> {
    const rows = await this.database.db
      .select({ internalEntityId: sourceIdentities.internalEntityId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, SQUARE_ITEM_ENTITY),
        ),
      );
    const productIds = rows
      .map((row) => row.internalEntityId)
      .filter((id): id is string => Boolean(id));
    if (productIds.length === 0) {
      return 0;
    }

    const assignments = await this.database.db
      .select({ productId: productCategoryAssignments.productId })
      .from(productCategoryAssignments)
      .where(inArray(productCategoryAssignments.productId, productIds));
    return assignments.length;
  }

  private async latestSnapshots(entityType: string): Promise<LatestSnapshot[]> {
    const rows = await this.database.db
      .select({
        id: sourceSnapshots.id,
        externalId: sourceSnapshots.externalId,
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, entityType),
        ),
      );

    const latest = new Map<string, LatestSnapshot>();
    for (const row of rows) {
      const existing = latest.get(row.externalId);
      if (!existing) {
        latest.set(row.externalId, row);
        continue;
      }
      if (row.observedAt.getTime() > existing.observedAt.getTime()) {
        latest.set(row.externalId, row);
        continue;
      }
      if (row.observedAt.getTime() === existing.observedAt.getTime()) {
        const rowVersion =
          typeof row.payload.version === "number" ? row.payload.version : 0;
        const existingVersion =
          typeof existing.payload.version === "number"
            ? existing.payload.version
            : 0;
        if (rowVersion > existingVersion) {
          latest.set(row.externalId, row);
        }
      }
    }
    return [...latest.values()];
  }
}
