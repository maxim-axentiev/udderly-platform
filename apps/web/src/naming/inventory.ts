import { safePhotoUrl } from "./format";

export type StaffNamingState =
  | "available"
  | "on_hold"
  | "claimed_unnamed"
  | "claimed_named";

export type StaffNamingView = {
  state: StaffNamingState;
  attention: "payment_reversed" | "review_required" | null;
  reviewReason:
    | "amount_mismatch"
    | "late_conflict"
    | "duplicate_booking"
    | "payment_reversed"
    | "underpaid"
    | "purchase_after_deadline"
    | "payment_time_unverified"
    | null;
  submittedName: string | null;
  purchaserName: string | null;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  orderNumber: string | null;
  paidAmountCents: number | null;
  currency: string | null;
  purchasedAt: string | null;
};

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
  naming: StaffNamingView;
};

export const STAFF_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "on_hold", label: "On Hold" },
  { id: "claimed_unnamed", label: "Claimed Not Named" },
  { id: "claimed_named", label: "Claimed Named" },
] as const;

export const STAFF_TIER_FILTERS = [
  { id: "all", label: "All" },
  { id: "10000", label: "$100" },
  { id: "25000", label: "$250" },
  { id: "50000", label: "$500" },
  { id: "100000", label: "$1,000" },
] as const;

export type StaffStatusFilter = (typeof STAFF_STATUS_FILTERS)[number]["id"];
export type StaffTierFilter = (typeof STAFF_TIER_FILTERS)[number]["id"];

const REVIEW_LABELS: Record<
  Exclude<StaffNamingView["reviewReason"], null>,
  string
> = {
  amount_mismatch: "Amount needs review",
  late_conflict: "Late payment needs review",
  duplicate_booking: "Duplicate booking needs review",
  payment_reversed: "Payment reversed",
  underpaid: "Underpaid",
  purchase_after_deadline: "Purchase after the deadline",
  payment_time_unverified: "Payment time needs review",
};

export function staffStateLabel(state: StaffNamingState): string {
  if (state === "on_hold") {
    return "On Hold";
  }
  if (state === "claimed_unnamed") {
    return "Claimed, Not Named";
  }
  if (state === "claimed_named") {
    return "Claimed, Named";
  }
  return "Available";
}

export function staffAttentionLabel(naming: StaffNamingView): string | null {
  if (naming.attention === "payment_reversed") {
    return "Payment reversed. This is not a normal paid claim.";
  }
  if (naming.attention === "review_required") {
    return naming.reviewReason
      ? `${REVIEW_LABELS[naming.reviewReason]}. This is not a normal paid claim.`
      : "Review required. This is not a normal paid claim.";
  }
  return null;
}

export function customerObjectCount(objects: readonly InventoryObject[]): number {
  return objects.filter((object) => !object.isTest).length;
}

export function outstandingNamingCount(objects: readonly InventoryObject[]): number {
  return objects.filter(
    (object) => !object.isTest && object.naming.state === "claimed_unnamed",
  ).length;
}

export function filterStaffObjects(
  objects: readonly InventoryObject[],
  filters: {
    status: StaffStatusFilter;
    tier: StaffTierFilter;
    query: string;
  },
): InventoryObject[] {
  const query = filters.query.trim().toLowerCase();
  return objects.filter((object) => {
    if (filters.status !== "all" && object.naming.state !== filters.status) {
      return false;
    }
    if (filters.tier !== "all" && String(object.priceCents) !== filters.tier) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      object.name,
      object.naming.submittedName ?? "",
      object.naming.purchaserEmail ?? "",
      object.naming.orderNumber ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

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
