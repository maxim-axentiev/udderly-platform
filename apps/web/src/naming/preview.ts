import { createServerFn } from "@tanstack/react-start";
import type { NamingObject } from "./api";

export function isNamingPreviewMode(value: string | undefined): boolean {
  return value === "true";
}

export const previewObjects: NamingObject[] = [
  {
    id: "preview-wheelbarrow",
    name: "Wheelbarrow",
    description: "A sample wheelbarrow for this preview.",
    photoUrl: null,
    priceCents: 10_000,
    currency: "CAD",
    availability: "available",
  },
  {
    id: "preview-poop-vacuum",
    name: "Poop Vacuum",
    description: "A sample poop vacuum for this preview.",
    photoUrl: null,
    priceCents: 35_000,
    currency: "CAD",
    availability: "available",
  },
  {
    id: "preview-tractor",
    name: "Tractor",
    description: "A sample tractor for this preview.",
    photoUrl: null,
    priceCents: 50_000,
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
      objects: enabled ? previewObjects : [],
    };
  },
);
