/**
 * Customer catalogues and launch publication use real objects only.
 * Test checkout is a separate staff route and does not publish these objects.
 */
export function isCustomerNamingObject(object: { isTest: boolean }): boolean {
  return !object.isTest;
}

export function isPreviewCustomerObject(object: {
  isTest: boolean;
  publishedAt: Date | null;
  status: string;
}): boolean {
  return (
    isCustomerNamingObject(object) &&
    object.publishedAt === null &&
    object.status === "available"
  );
}

export function isPublicCatalogObject(object: {
  isTest: boolean;
  publishedAt: Date | null;
}): boolean {
  return isCustomerNamingObject(object) && object.publishedAt !== null;
}

export function countPublicCatalogObjects(
  objects: readonly { isTest: boolean; publishedAt: Date | null }[],
): number {
  return objects.filter(isPublicCatalogObject).length;
}

/**
 * Objects a bulk launch may publish. Test objects are never included,
 * including when they are available and unpublished.
 */
export function selectCustomerLaunchObjects<
  T extends { isTest: boolean; publishedAt: Date | null; status: string },
>(objects: readonly T[]): T[] {
  return objects.filter(
    (object) =>
      isCustomerNamingObject(object) &&
      object.publishedAt === null &&
      object.status === "available",
  );
}
