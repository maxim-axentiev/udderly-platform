import { createHash, timingSafeEqual } from "node:crypto";

export const FAREHARBOR_PROVIDER = "fareharbor";
export const FAREHARBOR_BOOKING_ENTITY = "booking";
export const FAREHARBOR_BOOKING_EVENT_TYPE = "booking";

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeJson(value))
    .digest("hex");
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}

export function timingSafeSecretEqual(
  provided: string,
  expected: string,
): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  const length = Math.max(providedBuffer.length, expectedBuffer.length);
  const paddedProvided = Buffer.alloc(length);
  const paddedExpected = Buffer.alloc(length);
  providedBuffer.copy(paddedProvided);
  expectedBuffer.copy(paddedExpected);

  const contentsEqual = timingSafeEqual(paddedProvided, paddedExpected);
  const lengthEqual = providedBuffer.length === expectedBuffer.length;
  return contentsEqual && lengthEqual;
}
