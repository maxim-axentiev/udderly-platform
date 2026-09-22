import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  SQUARE_CATALOG_TYPES,
  SQUARE_CATEGORY_ENTITY,
  SQUARE_ITEM_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";
import {
  catalogSnapshotPayload,
  extractNestedCatalogVariations,
  sanitizeSquareCatalogObject,
  type SquareCatalogType,
} from "./square.catalog.sanitize";
import { hashCanonicalJson } from "./square.hash";
import { SquareService } from "./square.service";

export type SquareCatalogImportSummary = {
  categoriesFetched: number;
  itemsFetched: number;
  variationsFetched: number;
  snapshotsInserted: number;
  snapshotsUnchanged: number;
  snapshotsSkipped: number;
};

@Injectable()
export class SquareCatalogImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SquareService) private readonly square: SquareService,
  ) {}

  async importCatalog(): Promise<SquareCatalogImportSummary> {
    const client = this.square.createClient();
    const objects = await client.listCatalog([...SQUARE_CATALOG_TYPES]);
    return this.persistCatalogObjects(objects);
  }

  async persistCatalogObjects(
    objects: Record<string, unknown>[],
    options: {
      expandNestedVariations?: boolean;
      historicalRecovery?: boolean;
    } = {},
  ): Promise<SquareCatalogImportSummary> {
    const observedAt = new Date();
    let snapshotsInserted = 0;
    let snapshotsUnchanged = 0;
    let snapshotsSkipped = 0;
    let categoriesFetched = 0;
    let itemsFetched = 0;
    let variationsFetched = 0;
    const seen = new Set<string>();

    const records =
      options.expandNestedVariations === false
        ? objects
        : expandCatalogObjects(objects);
    for (const object of records) {
      const sanitized = sanitizeSquareCatalogObject(object);
      if (!sanitized) {
        snapshotsSkipped += 1;
        continue;
      }

      const entityType = entityTypeFor(sanitized.type);
      const key = `${entityType}:${sanitized.id}:${sanitized.version ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      if (sanitized.type === "CATEGORY") {
        categoriesFetched += 1;
      } else if (sanitized.type === "ITEM") {
        itemsFetched += 1;
      } else {
        variationsFetched += 1;
      }

      const result = await this.persistSnapshot(
        entityType,
        catalogSnapshotPayload(sanitized, {
          historicalRecovery: options.historicalRecovery,
        }),
        observedAt,
      );
      if (result === "inserted") {
        snapshotsInserted += 1;
      } else if (result === "unchanged") {
        snapshotsUnchanged += 1;
      } else {
        snapshotsSkipped += 1;
      }
    }

    return {
      categoriesFetched,
      itemsFetched,
      variationsFetched,
      snapshotsInserted,
      snapshotsUnchanged,
      snapshotsSkipped,
    };
  }

  private async persistSnapshot(
    entityType: string,
    payload: Record<string, unknown>,
    observedAt: Date,
  ): Promise<"inserted" | "unchanged" | "skipped"> {
    const externalId =
      typeof payload.id === "string" ? payload.id : undefined;
    if (!externalId) {
      return "skipped";
    }

    const payloadHash = hashCanonicalJson(payload);
    const existing = await this.database.db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, entityType),
          eq(sourceSnapshots.externalId, externalId),
          eq(sourceSnapshots.payloadHash, payloadHash),
        ),
      )
      .limit(1);

    if (existing[0]) {
      return "unchanged";
    }

    await this.database.db.insert(sourceSnapshots).values({
      provider: SQUARE_PROVIDER,
      entityType,
      externalId,
      observedAt,
      payload,
      payloadHash,
    });
    return "inserted";
  }
}

function entityTypeFor(type: SquareCatalogType): string {
  if (type === "CATEGORY") {
    return SQUARE_CATEGORY_ENTITY;
  }
  if (type === "ITEM") {
    return SQUARE_ITEM_ENTITY;
  }
  return SQUARE_ITEM_VARIATION_ENTITY;
}

function expandCatalogObjects(
  objects: Record<string, unknown>[],
): Record<string, unknown>[] {
  const expanded: Record<string, unknown>[] = [];
  for (const object of objects) {
    expanded.push(object);
    expanded.push(...extractNestedCatalogVariations(object));
  }
  return expanded;
}
