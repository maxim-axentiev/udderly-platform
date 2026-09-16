export type SquareCatalogType = "CATEGORY" | "ITEM" | "ITEM_VARIATION";

export type SquareCatalogSnapshot = {
  id: string;
  type: SquareCatalogType;
  version?: number;
  updatedAt?: string;
  isDeleted: boolean;
  isArchived: boolean;
  name?: string;
  sku?: string;
  itemId?: string;
  categoryIds: string[];
  variationIds: string[];
};

export function sanitizeSquareCatalogObject(
  object: unknown,
): SquareCatalogSnapshot | undefined {
  if (!isPlainObject(object)) {
    return undefined;
  }

  const id = stringValue(object.id);
  const type = catalogType(object.type);
  if (!id || !type) {
    return undefined;
  }

  const isDeleted = object.is_deleted === true;
  const version =
    typeof object.version === "number" ? object.version : undefined;
  const updatedAt = stringValue(object.updated_at);

  if (type === "CATEGORY") {
    const data = nestedObject(object.category_data);
    return {
      id,
      type,
      version,
      updatedAt,
      isDeleted,
      isArchived: data?.is_archived === true,
      name: data ? stringValue(data.name) : undefined,
      categoryIds: [],
      variationIds: [],
    };
  }

  if (type === "ITEM") {
    const data = nestedObject(object.item_data);
    return {
      id,
      type,
      version,
      updatedAt,
      isDeleted,
      isArchived: data?.is_archived === true,
      name: data ? stringValue(data.name) : undefined,
      categoryIds: extractItemCategoryIds(data),
      variationIds: extractNestedVariationIds(data),
    };
  }

  const data = nestedObject(object.item_variation_data);
  return {
    id,
    type,
    version,
    updatedAt,
    isDeleted,
    isArchived: data?.is_archived === true || object.is_archived === true,
    name: data ? stringValue(data.name) : undefined,
    sku: data ? stringValue(data.sku) : undefined,
    itemId: data ? stringValue(data.item_id) : undefined,
    categoryIds: [],
    variationIds: [],
  };
}

export function extractNestedCatalogVariations(
  object: unknown,
): Record<string, unknown>[] {
  if (!isPlainObject(object) || catalogType(object.type) !== "ITEM") {
    return [];
  }
  const data = nestedObject(object.item_data);
  if (!data) {
    return [];
  }
  const variations: Record<string, unknown>[] = [];
  for (const entry of nestedArray(data.variations)) {
    if (!isPlainObject(entry) || !stringValue(entry.id)) {
      continue;
    }
    variations.push(entry);
  }
  return variations;
}

/**
 * Prefer Square CatalogItem.categories[].id (current API).
 * Fall back to deprecated item_data.category_id only when the collection is empty.
 * reporting_category is not merchandising membership and is ignored.
 */
export function extractItemCategoryIds(
  itemData: Record<string, unknown> | undefined,
): string[] {
  if (!itemData) {
    return [];
  }

  const fromCollection: string[] = [];
  for (const entry of nestedArray(itemData.categories)) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const id = stringValue(entry.id);
    if (id) {
      fromCollection.push(id);
    }
  }
  if (fromCollection.length > 0) {
    return unique(fromCollection);
  }

  const legacy = stringValue(itemData.category_id);
  return legacy ? [legacy] : [];
}

function extractNestedVariationIds(
  itemData: Record<string, unknown> | undefined,
): string[] {
  if (!itemData) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of nestedArray(itemData.variations)) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const id = stringValue(entry.id);
    if (id) {
      ids.push(id);
    }
  }
  return unique(ids);
}

function catalogType(value: unknown): SquareCatalogType | undefined {
  if (value === "CATEGORY" || value === "ITEM" || value === "ITEM_VARIATION") {
    return value;
  }
  return undefined;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function catalogSnapshotPayload(
  snapshot: SquareCatalogSnapshot,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: snapshot.id,
    type: snapshot.type,
    is_deleted: snapshot.isDeleted,
    is_archived: snapshot.isArchived,
    category_ids: snapshot.categoryIds,
    variation_ids: snapshot.variationIds,
  };
  if (snapshot.version !== undefined) {
    payload.version = snapshot.version;
  }
  if (snapshot.updatedAt) {
    payload.updated_at = snapshot.updatedAt;
  }
  if (snapshot.name !== undefined) {
    payload.name = snapshot.name;
  }
  if (snapshot.sku !== undefined) {
    payload.sku = snapshot.sku;
  }
  if (snapshot.itemId !== undefined) {
    payload.item_id = snapshot.itemId;
  }
  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
