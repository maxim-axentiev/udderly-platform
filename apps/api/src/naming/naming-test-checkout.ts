/**
 * Staff test checkout stays closed unless NAMING_TEST_CHECKOUT_OBJECT_ID is
 * exactly one unpublished test object. Customer purchase paths do not read it.
 * The naming-link exception also requires the route marker Traefik sets on the
 * gift-card /naming router after Basic Auth. A client Host header is ignored.
 */
const OBJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const GIFT_CARD_NAMING_ROUTE_HEADER = "x-udderly-naming-route";
export const GIFT_CARD_NAMING_ROUTE = "giftcard";

export function parseTestCheckoutObjectId(
  value: string | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return OBJECT_ID.test(trimmed) ? trimmed : undefined;
}

export function customerCheckoutAllowed(object: {
  isTest: boolean;
  publishedAt: Date | null;
}): boolean {
  return !object.isTest && object.publishedAt !== null;
}

export function staffTestCheckoutAllowed(
  object: {
    id: string;
    isTest: boolean;
    publishedAt: Date | null;
    status: string;
  },
  configuredObjectId: string | undefined,
): boolean {
  return (
    configuredObjectId !== undefined &&
    object.id === configuredObjectId &&
    object.isTest &&
    object.publishedAt === null &&
    object.status === "available"
  );
}

export function giftcardNamingRouteAllowed(
  value: string | string[] | undefined,
): boolean {
  return value === GIFT_CARD_NAMING_ROUTE;
}

export function testNamingLinkAllowed(input: {
  configuredObjectId: string | undefined;
  route: string | string[] | undefined;
  objectId: string;
  isTest: boolean;
}): boolean {
  return (
    input.configuredObjectId !== undefined &&
    input.objectId === input.configuredObjectId &&
    input.isTest &&
    giftcardNamingRouteAllowed(input.route)
  );
}
