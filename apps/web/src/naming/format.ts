import { isFareharborCheckoutUrl as sharedIsFareharborCheckoutUrl } from "@udderly/shared";

export type NamingAvailability = "available" | "held" | "claimed";

export type ReservationStatus =
  | "awaiting_payment"
  | "expired"
  | "paid"
  | "named"
  | "review"
  | "underpaid"
  | "purchase_closed";

export const CAMPAIGN_DEADLINE_NOTE =
  "Naming purchases end December 31, 2026 at 11:59 p.m. Eastern Time. Names can be submitted until January 14, 2027 at 11:59 p.m. Eastern Time. A name is recognized at the farm from February 1, 2027 through January 31, 2028.";

export function formatPrice(cents: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function formatCatalogPrice(cents: number): string {
  if (Number.isInteger(cents) && cents >= 0 && cents % 100 === 0) {
    return `$${(cents / 100).toLocaleString("en-CA")}`;
  }
  return formatPrice(cents);
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function priceChoices(objects: Array<{ priceCents: number }>): number[] {
  return [...new Set(objects.map((object) => object.priceCents))].sort(
    (left, right) => left - right,
  );
}

export function filterByPrice<T extends { priceCents: number }>(
  objects: T[],
  priceCents: number | null,
): T[] {
  if (priceCents === null) {
    return objects;
  }
  return objects.filter((object) => object.priceCents === priceCents);
}

export function availabilityLabel(availability: NamingAvailability): string {
  if (availability === "available") {
    return "Available";
  }
  if (availability === "held") {
    return "On hold";
  }
  return "Claimed";
}

const STORED_PHOTO =
  /^\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
const PREVIEW_PHOTO =
  /^\/naming\/preview\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
const STAFF_PHOTO =
  /^\/inventory\/photos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

export function safePhotoUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  if (STORED_PHOTO.test(value) || PREVIEW_PHOTO.test(value) || STAFF_PHOTO.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function isFareharborCheckoutUrl(
  value: string,
  allowList?: ReadonlyArray<{ itemId: string; flowId: string }>,
): boolean {
  return sharedIsFareharborCheckoutUrl(value, allowList);
}

export function holdRemainingLabel(iso: string, now = Date.now()): string {
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) {
    return "The hold time could not be read.";
  }
  const minutes = Math.ceil((end - now) / 60_000);
  if (minutes <= 0) {
    return "The displayed hold time has passed. Check the status again before starting another reservation.";
  }
  if (minutes === 1) {
    return "About 1 minute left in this hold.";
  }
  return `About ${minutes} minutes left in this hold.`;
}

export function reservationStatusText(
  status: ReservationStatus,
  submittedName?: string,
): { heading: string; detail: string } {
  if (status === "awaiting_payment") {
    return {
      heading: "Awaiting payment",
      detail:
        "The gift card is not paid until FareHarbor records the purchase. Returning from checkout does not confirm payment.",
    };
  }
  if (status === "expired") {
    return {
      heading: "Hold ended",
      detail:
        "This reservation is no longer holding the object. You can choose an available object again.",
    };
  }
  if (status === "paid") {
    return {
      heading: "Payment recorded",
      detail:
        "The gift-card payment has been recorded. The private naming link is delivered separately.",
    };
  }
  if (status === "named") {
    return {
      heading: "Name submitted",
      detail: submittedName
        ? `This object has been named ${submittedName}.`
        : "This object has been named.",
    };
  }
  if (status === "underpaid") {
    return {
      heading: "Gift card below the naming minimum",
      detail:
        "The gift card is valid, and it does not include naming rights because the purchase is below this object's minimum.",
    };
  }
  if (status === "purchase_closed") {
    return {
      heading: "Purchase completed after the campaign",
      detail:
        "The gift card is valid. It was completed after December 31, 2026 at 11:59 p.m. Eastern Time, so it does not include naming rights.",
    };
  }
  return {
    heading: "Payment under review",
    detail:
      "This payment is being reviewed. A name cannot be submitted from this reservation yet.",
  };
}
