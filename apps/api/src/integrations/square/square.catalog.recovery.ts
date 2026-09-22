import { catalogVersionValue } from "./square.catalog.version";
import type { SquareFarmWindow } from "./square.range";

export type UnresolvedCatalogPair = {
  catalogObjectId: string;
  catalogVersion: number;
};

export type CatalogRecoveryDiscovery = {
  unresolvedSaleLines: number;
  pairs: UnresolvedCatalogPair[];
  distinctObjects: number;
  distinctVersions: number;
};

export type CatalogRecoveryRetrieveResult = {
  objects: Record<string, unknown>[];
  relatedObjects: Record<string, unknown>[];
};

export type CatalogRecoveryPersistSummary = {
  historicalObjectsRequested: number;
  historicalVariationsReturned: number;
  relatedItemsReturned: number;
  missingObjects: number;
  unexpectedObjectTypes: number;
  snapshotsInserted: number;
  snapshotsUnchanged: number;
};

export function discoverUnresolvedCatalogPairs(
  orders: { payload: Record<string, unknown> }[],
  resolvedVariationIds: Set<string>,
): CatalogRecoveryDiscovery {
  const pairs = new Map<string, UnresolvedCatalogPair>();
  let unresolvedSaleLines = 0;

  for (const order of orders) {
    for (const line of nestedArray(order.payload.line_items)) {
      if (!isPlainObject(line)) {
        continue;
      }
      const catalogObjectId = stringValue(line.catalog_object_id);
      if (!catalogObjectId) {
        continue;
      }
      if (resolvedVariationIds.has(catalogObjectId)) {
        continue;
      }
      const catalogVersion = catalogVersionValue(line.catalog_version);
      if (catalogVersion === undefined) {
        continue;
      }
      unresolvedSaleLines += 1;
      const key = `${catalogObjectId}:${catalogVersion}`;
      if (!pairs.has(key)) {
        pairs.set(key, { catalogObjectId, catalogVersion });
      }
    }
  }

  const list = [...pairs.values()];
  return {
    unresolvedSaleLines,
    pairs: list,
    distinctObjects: new Set(list.map((pair) => pair.catalogObjectId)).size,
    distinctVersions: new Set(list.map((pair) => pair.catalogVersion)).size,
  };
}

export function groupCatalogPairsByVersion(
  pairs: UnresolvedCatalogPair[],
): { catalogVersion: number; objectIds: string[] }[] {
  const groups = new Map<number, string[]>();
  for (const pair of pairs) {
    const ids = groups.get(pair.catalogVersion) ?? [];
    if (!ids.includes(pair.catalogObjectId)) {
      ids.push(pair.catalogObjectId);
    }
    groups.set(pair.catalogVersion, ids);
  }
  return [...groups.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([catalogVersion, objectIds]) => ({ catalogVersion, objectIds }));
}

export function selectRecoveredCatalogObjects(
  pairs: UnresolvedCatalogPair[],
  retrieved: CatalogRecoveryRetrieveResult,
): {
  persist: Record<string, unknown>[];
  summary: Omit<
    CatalogRecoveryPersistSummary,
    "snapshotsInserted" | "snapshotsUnchanged"
  >;
} {
  const pool = [...retrieved.objects, ...retrieved.relatedObjects];
  const persist: Record<string, unknown>[] = [];
  const persistedKeys = new Set<string>();
  let historicalVariationsReturned = 0;
  let missingObjects = 0;
  let unexpectedObjectTypes = 0;
  let relatedItemsReturned = 0;

  for (const pair of pairs) {
    const object = findCatalogObject(
      pool,
      pair.catalogObjectId,
      pair.catalogVersion,
    );
    if (!object) {
      missingObjects += 1;
      continue;
    }
    if (object.type !== "ITEM_VARIATION") {
      unexpectedObjectTypes += 1;
      continue;
    }
    historicalVariationsReturned += 1;
    const variationKey = `${pair.catalogObjectId}:${pair.catalogVersion}`;
    if (!persistedKeys.has(variationKey)) {
      persist.push(object);
      persistedKeys.add(variationKey);
    }
    const parentId = variationParentId(object);
    if (!parentId) {
      continue;
    }
    const parent = findCatalogObject(pool, parentId, pair.catalogVersion);
    if (!parent || parent.type !== "ITEM") {
      continue;
    }
    const parentKey = `${parentId}:${pair.catalogVersion}`;
    if (!persistedKeys.has(parentKey)) {
      persist.push(parent);
      persistedKeys.add(parentKey);
      relatedItemsReturned += 1;
    }
  }

  return {
    persist,
    summary: {
      historicalObjectsRequested: pairs.length,
      historicalVariationsReturned,
      relatedItemsReturned,
      missingObjects,
      unexpectedObjectTypes,
    },
  };
}

function findCatalogObject(
  pool: Record<string, unknown>[],
  id: string,
  catalogVersion: number,
): Record<string, unknown> | undefined {
  const versionMatch = pool.find((object) => {
    const objectId = stringValue(object.id);
    return (
      objectId === id && catalogVersionValue(object.version) === catalogVersion
    );
  });
  if (versionMatch) {
    return versionMatch;
  }
  return pool.find((object) => stringValue(object.id) === id);
}

export function formatCatalogRecoveryDiscovery(
  discovery: CatalogRecoveryDiscovery,
  window: SquareFarmWindow,
): string {
  const range =
    "date" in window
      ? `${window.date} to ${window.date}`
      : `${window.from} to ${window.to}`;
  return [
    "Historical catalog recovery",
    "",
    `Range: ${range}`,
    "",
    `Unresolved sale lines: ${discovery.unresolvedSaleLines}`,
    `Distinct object/version pairs: ${discovery.pairs.length}`,
    `Distinct catalog objects: ${discovery.distinctObjects}`,
    `Catalog versions: ${discovery.distinctVersions}`,
  ].join("\n");
}

export function formatCatalogRecoveryResult(
  discovery: CatalogRecoveryDiscovery,
  persist: CatalogRecoveryPersistSummary,
): string {
  return [
    "Square historical catalog recovery",
    "",
    `Unresolved sale lines: ${discovery.unresolvedSaleLines}`,
    `Distinct objects: ${discovery.distinctObjects}`,
    `Object/version pairs: ${discovery.pairs.length}`,
    "",
    `Historical objects requested: ${persist.historicalObjectsRequested}`,
    `Historical variations returned: ${persist.historicalVariationsReturned}`,
    `Related items returned: ${persist.relatedItemsReturned}`,
    `Missing objects: ${persist.missingObjects}`,
    `Unexpected object types: ${persist.unexpectedObjectTypes}`,
    "",
    `Snapshots inserted: ${persist.snapshotsInserted}`,
    `Snapshots unchanged: ${persist.snapshotsUnchanged}`,
  ].join("\n");
}

function variationParentId(object: Record<string, unknown>): string | undefined {
  const data = nestedObject(object.item_variation_data);
  return stringValue(data?.item_id);
}

function nestedObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function nestedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
