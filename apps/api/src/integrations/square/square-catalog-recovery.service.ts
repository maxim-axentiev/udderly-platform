import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  INTERNAL_PRODUCT_VARIATION,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_ORDER_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";
import { SquareCatalogImportService } from "./square-catalog-import.service";
import {
  discoverUnresolvedCatalogPairs,
  formatCatalogRecoveryDiscovery,
  formatCatalogRecoveryResult,
  groupCatalogPairsByVersion,
  selectRecoveredCatalogObjects,
  type CatalogRecoveryDiscovery,
  type CatalogRecoveryPersistSummary,
} from "./square.catalog.recovery";
import {
  pickLatestSnapshots,
} from "./square.commerce.snapshots";
import { squareFarmUtcRange, type SquareFarmWindow } from "./square.range";
import { SquareService } from "./square.service";

export type SquareCatalogRecoveryResult = {
  dryRun: boolean;
  discovery: CatalogRecoveryDiscovery;
  persist?: CatalogRecoveryPersistSummary;
  report: string;
};

@Injectable()
export class SquareCatalogRecoveryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SquareService) private readonly square: SquareService,
    @Inject(SquareCatalogImportService)
    private readonly catalogImport: SquareCatalogImportService,
  ) {}

  async recoverWindow(
    window: SquareFarmWindow,
    options: { dryRun?: boolean } = {},
  ): Promise<SquareCatalogRecoveryResult> {
    const discovery = await this.discoverWindow(window);
    if (options.dryRun) {
      return {
        dryRun: true,
        discovery,
        report: `${formatCatalogRecoveryDiscovery(discovery, window)}\n\nDry run only. No Square API calls. No data changed.`,
      };
    }

    const persist = await this.retrieveAndPersist(discovery);
    return {
      dryRun: false,
      discovery,
      persist,
      report: formatCatalogRecoveryResult(discovery, persist),
    };
  }

  async discoverWindow(
    window: SquareFarmWindow,
  ): Promise<CatalogRecoveryDiscovery> {
    const range = squareFarmUtcRange(window);
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
          eq(sourceSnapshots.entityType, SQUARE_ORDER_ENTITY),
        ),
      );
    const latest = pickLatestSnapshots(rows, SQUARE_ORDER_ENTITY, range);
    const resolved = await this.resolvedVariationIds();
    return discoverUnresolvedCatalogPairs(latest, resolved);
  }

  private async resolvedVariationIds(): Promise<Set<string>> {
    const rows = await this.database.db
      .select({ externalId: sourceIdentities.externalId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, SQUARE_ITEM_VARIATION_ENTITY),
          eq(sourceIdentities.internalEntityType, INTERNAL_PRODUCT_VARIATION),
          isNotNull(sourceIdentities.internalEntityId),
        ),
      );
    return new Set(
      rows
        .map((row) => row.externalId)
        .filter((id): id is string => Boolean(id)),
    );
  }

  private async retrieveAndPersist(
    discovery: CatalogRecoveryDiscovery,
  ): Promise<CatalogRecoveryPersistSummary> {
    if (discovery.pairs.length === 0) {
      return {
        historicalObjectsRequested: 0,
        historicalVariationsReturned: 0,
        relatedItemsReturned: 0,
        missingObjects: 0,
        unexpectedObjectTypes: 0,
        snapshotsInserted: 0,
        snapshotsUnchanged: 0,
      };
    }

    const client = this.square.createClient();
    const retrieved = {
      objects: [] as Record<string, unknown>[],
      relatedObjects: [] as Record<string, unknown>[],
    };
    for (const group of groupCatalogPairsByVersion(discovery.pairs)) {
      const page = await client.batchRetrieveCatalogObjects({
        objectIds: group.objectIds,
        catalogVersion: group.catalogVersion,
        includeDeletedObjects: true,
        includeRelatedObjects: true,
      });
      retrieved.objects.push(...page.objects);
      retrieved.relatedObjects.push(...page.relatedObjects);
    }

    const persist = await this.persistRetrieved(discovery.pairs, retrieved);
    return persist;
  }

  async persistRetrieved(
    pairs: CatalogRecoveryDiscovery["pairs"],
    retrieved: {
      objects: Record<string, unknown>[];
      relatedObjects: Record<string, unknown>[];
    },
  ): Promise<CatalogRecoveryPersistSummary> {
    const selected = selectRecoveredCatalogObjects(pairs, retrieved);
    const persisted = await this.catalogImport.persistCatalogObjects(
      selected.persist,
      { expandNestedVariations: false, historicalRecovery: true },
    );
    return {
      ...selected.summary,
      snapshotsInserted: persisted.snapshotsInserted,
      snapshotsUnchanged: persisted.snapshotsUnchanged,
    };
  }
}
