import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverUnresolvedCatalogPairs,
  formatCatalogRecoveryDiscovery,
  groupCatalogPairsByVersion,
  selectRecoveredCatalogObjects,
} from "./square.catalog.recovery";
import { catalogSnapshotIsNewer } from "./square.catalog.version";
import { squareCatalogStatus } from "./square.catalog.status";

function orderWithLines(
  lines: Record<string, unknown>[],
): { payload: Record<string, unknown> } {
  return {
    payload: {
      id: "order",
      closed_at: "2026-06-15T16:00:00.000Z",
      line_items: lines,
    },
  };
}

test("A. unresolved catalog line is discovered", () => {
  const discovery = discoverUnresolvedCatalogPairs(
    [
      orderWithLines([
        {
          uid: "L1",
          catalog_object_id: "VAR-MISSING",
          catalog_version: 100,
        },
      ]),
    ],
    new Set(),
  );
  assert.equal(discovery.unresolvedSaleLines, 1);
  assert.equal(discovery.distinctObjects, 1);
  assert.deepEqual(discovery.pairs, [
    { catalogObjectId: "VAR-MISSING", catalogVersion: 100 },
  ]);
});

test("B. already-resolved variation is ignored", () => {
  const discovery = discoverUnresolvedCatalogPairs(
    [
      orderWithLines([
        {
          uid: "L1",
          catalog_object_id: "VAR-OK",
          catalog_version: 100,
        },
      ]),
    ],
    new Set(["VAR-OK"]),
  );
  assert.equal(discovery.unresolvedSaleLines, 0);
  assert.equal(discovery.pairs.length, 0);
});

test("C. missing catalog_version cannot be historically recovered", () => {
  const discovery = discoverUnresolvedCatalogPairs(
    [
      orderWithLines([
        { uid: "L1", catalog_object_id: "VAR-NO-VERSION" },
      ]),
    ],
    new Set(),
  );
  assert.equal(discovery.unresolvedSaleLines, 0);
  assert.equal(discovery.pairs.length, 0);
});

test("D. duplicate object/version pair is fetched once", () => {
  const discovery = discoverUnresolvedCatalogPairs(
    [
      orderWithLines([
        {
          uid: "L1",
          catalog_object_id: "VAR-A",
          catalog_version: 50,
        },
        {
          uid: "L2",
          catalog_object_id: "VAR-A",
          catalog_version: 50,
        },
      ]),
    ],
    new Set(),
  );
  assert.equal(discovery.unresolvedSaleLines, 2);
  assert.equal(discovery.pairs.length, 1);
  const groups = groupCatalogPairsByVersion(discovery.pairs);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.objectIds, ["VAR-A"]);
});

test("E. same object at two versions remains two recovery groups", () => {
  const discovery = discoverUnresolvedCatalogPairs(
    [
      orderWithLines([
        {
          uid: "L1",
          catalog_object_id: "VAR-A",
          catalog_version: 10,
        },
        {
          uid: "L2",
          catalog_object_id: "VAR-A",
          catalog_version: 20,
        },
      ]),
    ],
    new Set(),
  );
  assert.equal(discovery.pairs.length, 2);
  const groups = groupCatalogPairsByVersion(discovery.pairs);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.catalogVersion).sort((a, b) => a - b),
    [10, 20],
  );
});

test("J. unexpected object type is not mapped as a variation", () => {
  const selected = selectRecoveredCatalogObjects(
    [{ catalogObjectId: "NOT-VAR", catalogVersion: 1 }],
    {
      objects: [{ id: "NOT-VAR", type: "ITEM" }],
      relatedObjects: [],
    },
  );
  assert.equal(selected.summary.unexpectedObjectTypes, 1);
  assert.equal(selected.summary.historicalVariationsReturned, 0);
  assert.equal(selected.persist.length, 0);
});

test("K. missing Square object is not fabricated", () => {
  const selected = selectRecoveredCatalogObjects(
    [{ catalogObjectId: "MISSING", catalogVersion: 1 }],
    { objects: [], relatedObjects: [] },
  );
  assert.equal(selected.summary.missingObjects, 1);
  assert.equal(selected.persist.length, 0);
});

test("F/G. historical variation and related parent item are selected", () => {
  const selected = selectRecoveredCatalogObjects(
    [{ catalogObjectId: "VAR-HIST", catalogVersion: 9 }],
    {
      objects: [
        {
          id: "VAR-HIST",
          type: "ITEM_VARIATION",
          version: 9,
          item_variation_data: { item_id: "ITEM-HIST", name: "Each" },
        },
      ],
      relatedObjects: [
        {
          id: "ITEM-HIST",
          type: "ITEM",
          version: 9,
          item_data: { name: "Parent", variations: [{ id: "OTHER-VAR" }] },
        },
        { id: "OTHER-VAR", type: "ITEM_VARIATION" },
      ],
    },
  );
  assert.equal(selected.summary.historicalVariationsReturned, 1);
  assert.equal(selected.summary.relatedItemsReturned, 1);
  assert.deepEqual(
    selected.persist.map((object) => object.id),
    ["VAR-HIST", "ITEM-HIST"],
  );
});

test("discovery report omits ids and names", () => {
  const report = formatCatalogRecoveryDiscovery(
    {
      unresolvedSaleLines: 3,
      pairs: [
        { catalogObjectId: "SECRET", catalogVersion: 1 },
        { catalogObjectId: "SECRET-2", catalogVersion: 1 },
      ],
      distinctObjects: 2,
      distinctVersions: 1,
    },
    { from: "2026-06-01", to: "2026-06-30" },
  );
  assert.match(report, /Unresolved sale lines: 3/);
  assert.match(report, /Distinct catalog objects: 2/);
  assert.equal(report.includes("SECRET"), false);
});

test("older observed_at does not outrank a higher catalog version", () => {
  const olderObservedNewerVersion = {
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { version: 20 },
  };
  const newerObservedOlderVersion = {
    observedAt: new Date("2026-09-01T00:00:00.000Z"),
    payload: { version: 5 },
  };
  assert.equal(
    catalogSnapshotIsNewer(olderObservedNewerVersion, newerObservedOlderVersion),
    true,
  );
  assert.equal(
    catalogSnapshotIsNewer(newerObservedOlderVersion, olderObservedNewerVersion),
    false,
  );
});

test("historical recovery without is_deleted is not treated as currently active", () => {
  assert.equal(
    squareCatalogStatus({ historicalRecovery: true }),
    "archived",
  );
  assert.equal(
    squareCatalogStatus({ historicalRecovery: true, isDeleted: true }),
    "deleted",
  );
});
