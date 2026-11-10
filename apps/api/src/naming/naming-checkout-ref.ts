import { randomBytes } from "node:crypto";

const CHECKOUT_REF_BYTES = 16;

export function createCheckoutRef(): string {
  return randomBytes(CHECKOUT_REF_BYTES).toString("base64url");
}
