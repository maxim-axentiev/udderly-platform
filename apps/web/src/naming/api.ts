import type { NamingAvailability, ReservationStatus } from "./format";

export class NamingApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NamingApiError";
    this.status = status;
  }
}

export type NamingObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
  availability: NamingAvailability;
};

export type CreatedReservation = {
  reservationId: string;
  holdExpiresAt: string;
  checkoutUrl: string;
};

export type ReservationView = {
  reservationId: string;
  status: ReservationStatus;
  holdExpiresAt?: string;
  submittedName?: string;
  object: {
    id: string;
    name: string;
    description: string;
    photoUrl: string | null;
    priceCents: number;
    currency: string;
  };
};

export type NamingLinkView = {
  objectName: string;
  description: string;
  photoUrl: string | null;
  namingStatus: "awaiting_name" | "named";
  submittedName: string | null;
  submissionOpen: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unexpected = new NamingApiError(
  0,
  "The naming service returned an unexpected response.",
);

export function resolveApiBaseUrl(
  configured: string | undefined,
  production: boolean,
): string {
  const value = configured?.trim();
  if (value) {
    return value.replace(/\/$/, "");
  }
  return production ? "" : "http://localhost:3001";
}

export function apiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.PROD);
}

export function namingErrorMessage(error: unknown, notFound: string): string {
  if (error instanceof NamingApiError) {
    if (error.status === 404) {
      return notFound;
    }
    return error.message;
  }
  return "The naming service could not be reached.";
}

export async function fetchNamingObjects(
  signal?: AbortSignal,
): Promise<NamingObject[]> {
  return parseCatalog(await requestJson("/naming/objects", { signal }));
}

export async function fetchPreviewCatalog(
  signal?: AbortSignal,
): Promise<NamingObject[]> {
  return parseCatalog(await requestJson("/naming/preview/catalog", { signal }));
}

export async function createReservation(
  objectId: string,
): Promise<CreatedReservation> {
  return parseCreatedReservation(
    await requestJson("/naming/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectId }),
    }),
  );
}

export async function fetchReservation(
  reservationId: string,
  signal?: AbortSignal,
): Promise<ReservationView> {
  return parseReservation(
    await requestJson(
      `/naming/reservations/${encodeURIComponent(reservationId)}`,
      { signal },
    ),
  );
}

export async function fetchNamingLink(
  token: string,
  signal?: AbortSignal,
): Promise<NamingLinkView> {
  return parseNamingLink(
    await requestJson(`/naming/links/${encodeURIComponent(token)}`, { signal }),
  );
}

export async function submitNamingName(
  token: string,
  name: string,
): Promise<{ submittedName: string }> {
  const payload = await requestJson(`/naming/links/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!isRecord(payload) || typeof payload.submittedName !== "string") {
    throw unexpected;
  }
  return { submittedName: payload.submittedName };
}

export function parseCatalog(value: unknown): NamingObject[] {
  if (!isRecord(value) || !Array.isArray(value.objects)) {
    throw unexpected;
  }
  return value.objects.map(parseObject);
}

export function parseCreatedReservation(value: unknown): CreatedReservation {
  if (
    !isRecord(value) ||
    typeof value.reservationId !== "string" ||
    !UUID_PATTERN.test(value.reservationId) ||
    typeof value.holdExpiresAt !== "string" ||
    Number.isNaN(new Date(value.holdExpiresAt).getTime()) ||
    typeof value.checkoutUrl !== "string"
  ) {
    throw unexpected;
  }
  return {
    reservationId: value.reservationId,
    holdExpiresAt: value.holdExpiresAt,
    checkoutUrl: value.checkoutUrl,
  };
}

export function parseReservation(value: unknown): ReservationView {
  if (!isRecord(value) || typeof value.reservationId !== "string") {
    throw unexpected;
  }
  if (!isReservationStatus(value.status) || !isRecord(value.object)) {
    throw unexpected;
  }
  const object = parsePublicObject(value.object);
  const view: ReservationView = {
    reservationId: value.reservationId,
    status: value.status,
    object,
  };
  if (value.holdExpiresAt !== undefined) {
    if (
      typeof value.holdExpiresAt !== "string" ||
      Number.isNaN(new Date(value.holdExpiresAt).getTime())
    ) {
      throw unexpected;
    }
    view.holdExpiresAt = value.holdExpiresAt;
  }
  if (value.submittedName !== undefined) {
    if (typeof value.submittedName !== "string") {
      throw unexpected;
    }
    view.submittedName = value.submittedName;
  }
  return view;
}

export function parseNamingLink(value: unknown): NamingLinkView {
  if (
    !isRecord(value) ||
    typeof value.objectName !== "string" ||
    typeof value.description !== "string" ||
    !isNullableString(value.photoUrl) ||
    (value.namingStatus !== "awaiting_name" && value.namingStatus !== "named") ||
    !isNullableString(value.submittedName) ||
    typeof value.submissionOpen !== "boolean"
  ) {
    throw unexpected;
  }
  return {
    objectName: value.objectName,
    description: value.description,
    photoUrl: value.photoUrl,
    namingStatus: value.namingStatus,
    submittedName: value.submittedName,
    submissionOpen: value.submissionOpen,
  };
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new NamingApiError(0, "The naming service could not be reached.");
  }
  if (!response.ok) {
    throw new NamingApiError(response.status, await errorMessage(response));
  }
  return response.json() as Promise<unknown>;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) {
      return body.message;
    }
    if (Array.isArray(body.message)) {
      const text = body.message.filter((item) => typeof item === "string").join(" ");
      if (text) {
        return text;
      }
    }
  } catch {
    return fallbackStatusMessage(response.status);
  }
  return fallbackStatusMessage(response.status);
}

function fallbackStatusMessage(status: number): string {
  if (status === 429) {
    return "Too many requests. Try again later.";
  }
  if (status === 404) {
    return "Not found";
  }
  return `The naming service returned HTTP ${status}.`;
}

function parseObject(value: unknown): NamingObject {
  if (!isRecord(value) || !isAvailability(value.availability)) {
    throw unexpected;
  }
  const object = parsePublicObject(value);
  return { ...object, availability: value.availability };
}

function parsePublicObject(value: Record<string, unknown>): {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  currency: string;
} {
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    !isNullableString(value.photoUrl) ||
    typeof value.priceCents !== "number" ||
    !Number.isInteger(value.priceCents) ||
    typeof value.currency !== "string"
  ) {
    throw unexpected;
  }
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    photoUrl: value.photoUrl,
    priceCents: value.priceCents,
    currency: value.currency,
  };
}

function isReservationStatus(value: unknown): value is ReservationStatus {
  return (
    value === "awaiting_payment" ||
    value === "expired" ||
    value === "paid" ||
    value === "named" ||
    value === "review" ||
    value === "underpaid" ||
    value === "purchase_closed"
  );
}

function isAvailability(value: unknown): value is NamingAvailability {
  return value === "available" || value === "held" || value === "claimed";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
