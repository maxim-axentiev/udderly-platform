import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const INVENTORY_COOKIE = "naming_inventory";
export const INVENTORY_COOKIE_PATH = "/inventory";
export const INVENTORY_SESSION_MS = 12 * 60 * 60 * 1000;
export const INVENTORY_CSRF_HEADER = "x-csrf-token";

const CSRF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

type SessionPayload = {
  v: 1;
  exp: number;
  csrf: string;
  sid: string;
};

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function passwordsMatch(provided: string, expected: string): boolean {
  return digestsMatch(provided, expected);
}

export function tokensMatch(provided: string, expected: string): boolean {
  return digestsMatch(provided, expected);
}

export function signInventorySession(
  secret: string,
  expiresAt: number,
  csrf: string,
  sid: string,
): string {
  const payload: SessionPayload = { v: 1, exp: expiresAt, csrf, sid };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function openInventorySession(
  secret: string,
  token: string,
  now: number,
): { csrf: string; exp: number; sid: string } | undefined {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return undefined;
  }
  const [body, mac] = parts;
  if (!body || !mac) {
    return undefined;
  }
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!fixedEqual(mac, expected)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isSessionPayload(parsed) || parsed.exp <= now) {
    return undefined;
  }
  return { csrf: parsed.csrf, exp: parsed.exp, sid: parsed.sid };
}

export function inventorySessionCookie(token: string, maxAgeSeconds: number): string {
  const value = maxAgeSeconds > 0 ? token : "";
  return [
    `${INVENTORY_COOKIE}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Path=${INVENTORY_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function digestsMatch(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<SessionPayload>;
  return (
    payload.v === 1 &&
    typeof payload.exp === "number" &&
    Number.isFinite(payload.exp) &&
    typeof payload.csrf === "string" &&
    CSRF_PATTERN.test(payload.csrf) &&
    typeof payload.sid === "string" &&
    SESSION_ID_PATTERN.test(payload.sid)
  );
}
