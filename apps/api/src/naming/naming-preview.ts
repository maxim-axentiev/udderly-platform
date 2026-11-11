import type { PublicNamingObject } from "./naming-public.service";

const PREVIEW_EXCLUDED_NAME = "test naming bucket";
const GIFT_CARD_HOST = "giftcard.udderlyridiculousfarmlife.com";
const STORED_PHOTO =
  /^\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/i;

export type PreviewSourceObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceAmount: number;
  currency: string;
  publishedAt: Date | null;
  status: string;
};

export function previewRequestAllowed(input: {
  previewMode: boolean;
  nodeEnv: string;
  host: string | undefined;
}): boolean {
  if (!input.previewMode) {
    return false;
  }
  if (input.nodeEnv !== "production") {
    return true;
  }
  return hostName(input.host) === GIFT_CARD_HOST;
}

export function isPreviewCatalogObject(object: PreviewSourceObject): boolean {
  return (
    object.publishedAt === null &&
    object.status === "available" &&
    object.name.trim().toLowerCase() !== PREVIEW_EXCLUDED_NAME
  );
}

export function previewPhotoPath(photoUrl: string | null): string | null {
  const match = photoUrl?.match(STORED_PHOTO);
  if (!match) {
    return null;
  }
  return `/naming/preview/photos/${match[1].toLowerCase()}.${match[2].toLowerCase()}`;
}

export function selectPreviewCatalog(
  objects: readonly PreviewSourceObject[],
): PublicNamingObject[] {
  return objects
    .filter(isPreviewCatalogObject)
    .map((object) => ({
      id: object.id,
      name: object.name,
      description: object.description,
      photoUrl: previewPhotoPath(object.photoUrl),
      priceCents: object.priceAmount,
      currency: object.currency,
      availability: "available" as const,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function hostName(value: string | undefined): string {
  return (value ?? "").split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
}
