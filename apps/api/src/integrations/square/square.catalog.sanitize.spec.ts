import assert from "node:assert/strict";
import test from "node:test";
import {
  extractItemCategoryIds,
  sanitizeSquareCatalogObject,
} from "./square.catalog.sanitize";
import { squareCatalogStatus } from "./square.catalog.status";

test("prefers item_data.categories[].id over deprecated category_id", () => {
  const ids = extractItemCategoryIds({
    category_id: "LEGACY",
    categories: [{ id: "CAT_A" }, { id: "CAT_B" }],
    reporting_category: { id: "REPORT" },
  });
  assert.deepEqual(ids, ["CAT_A", "CAT_B"]);
});

test("falls back to category_id only when categories is empty", () => {
  const ids = extractItemCategoryIds({
    category_id: "LEGACY",
    categories: [],
  });
  assert.deepEqual(ids, ["LEGACY"]);
});

test("sanitizes category, item, and variation without extra payload fields", () => {
  const category = sanitizeSquareCatalogObject({
    type: "CATEGORY",
    id: "C1",
    version: 3,
    updated_at: "2026-01-01T00:00:00Z",
    is_deleted: false,
    category_data: { name: "Cheese", is_archived: false },
    present_at_all_locations: true,
  });
  assert.equal(category?.name, "Cheese");
  assert.equal(category?.type, "CATEGORY");
  assert.equal("present_at_all_locations" in (category ?? {}), false);

  const item = sanitizeSquareCatalogObject({
    type: "ITEM",
    id: "I1",
    item_data: {
      name: "Gouda",
      is_archived: true,
      categories: [{ id: "C1" }],
      description: "do not persist",
      variations: [{ id: "V1", type: "ITEM_VARIATION" }],
    },
  });
  assert.equal(item?.isArchived, true);
  assert.deepEqual(item?.categoryIds, ["C1"]);
  assert.deepEqual(item?.variationIds, ["V1"]);

  const variation = sanitizeSquareCatalogObject({
    type: "ITEM_VARIATION",
    id: "V1",
    item_variation_data: {
      item_id: "I1",
      name: "Each",
      sku: "SKU-1",
      price_money: { amount: 100, currency: "CAD" },
    },
  });
  assert.equal(variation?.sku, "SKU-1");
  assert.equal(variation?.itemId, "I1");
});

test("deleted wins over archived for canonical status", () => {
  assert.equal(
    squareCatalogStatus({ isDeleted: true, isArchived: true }),
    "deleted",
  );
  assert.equal(
    squareCatalogStatus({ isDeleted: false, isArchived: true }),
    "archived",
  );
  assert.equal(squareCatalogStatus({}), "active");
});
