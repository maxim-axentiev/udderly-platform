import { safePhotoUrl } from "./format";

export type InventoryObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
  availability: "available" | "held" | "claimed";
  published: boolean;
  isTest: boolean;
};

export function staffCanPublish(object: {
  isTest: boolean;
  availability: string;
  published: boolean;
}): boolean {
  return !object.isTest && object.availability === "available" && !object.published;
}

export class InventoryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "InventoryError";
    this.status = status;
  }
}

export function dollarsToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return undefined;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    return undefined;
  }
  return cents;
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function inventoryPhotoSrc(photoUrl: string | null): string | null {
  if (
    photoUrl &&
    /^\/photos\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(photoUrl)
  ) {
    return `/inventory${photoUrl}`;
  }
  return safePhotoUrl(photoUrl);
}

export async function inventoryRequest<T>(
  path: string,
  csrfToken: string | undefined,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new InventoryError(response.status, await errorMessage(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") {
      return body.message;
    }
  } catch {
    return "The inventory request failed.";
  }
  return "The inventory request failed.";
}
