import { createServerFn } from "@tanstack/react-start";
import type { NamingObject } from "./api";

export function isNamingPreviewMode(value: string | undefined): boolean {
  return value === "true";
}

export function canPurchaseInPreview(previewEnabled: boolean): boolean {
  return !previewEnabled;
}

export const PREVIEW_BANNER =
  "This is a private preview of the real objects. Buy & Claim is turned off.";

export const previewObjects: NamingObject[] = [
  {
    id: "preview-bucket",
    name: "Blue Bucket",
    description: "A sample object for this preview.",
    photoUrl: null,
    priceCents: 10_000,
    currency: "CAD",
    availability: "available",
  },
  {
    id: "preview-slide",
    name: "Goat Slide",
    description: "A sample object for this preview.",
    photoUrl: null,
    priceCents: 25_000,
    currency: "CAD",
    availability: "held",
  },
  {
    id: "preview-tractor",
    name: "Yellow Tractor",
    description: "A sample object for this preview.",
    photoUrl: null,
    priceCents: 50_000,
    currency: "CAD",
    availability: "claimed",
  },
  {
    id: "preview-tower",
    name: "Goat Tower",
    description: "A sample object for this preview.",
    photoUrl: null,
    priceCents: 100_000,
    currency: "CAD",
    availability: "available",
  },
];

function previewFlag(): string | undefined {
  const key = "NAMING_PREVIEW_MODE";
  return process.env[key];
}

export const loadCampaignPreview = createServerFn({ method: "GET" }).handler(
  async () => {
    const enabled = isNamingPreviewMode(previewFlag());
    return {
      enabled,
    };
  },
);
