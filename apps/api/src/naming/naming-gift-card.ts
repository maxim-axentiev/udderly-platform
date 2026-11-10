import { createHash, randomBytes } from "node:crypto";
import { FAREHARBOR_GIFT_CARD_ITEM_ID } from "./naming.constants";

export type NamingGiftCardReading =
  | { kind: "malformed" }
  | { kind: "no_reference" }
  | {
      kind: "ignored";
      reason: "wrong_item" | "invalid_payment" | "not_booked";
    }
  | {
      kind: "refunded";
      checkoutRef: string;
      bookingUuid: string;
      paidAmount: number | null;
    }
  | {
      kind: "payable";
      checkoutRef: string;
      bookingUuid: string;
      paidAmount: number;
      paidAt: Date | null;
    };

/**
 * Reads the gift-card fields confirmed on FareHarbor item 308290.
 * Contact, card, and display-only fields are ignored.
 */
export function readFareharborGiftCard(payload: unknown): NamingGiftCardReading {
  if (!isPlainObject(payload) || !isPlainObject(payload.booking)) {
    return { kind: "malformed" };
  }

  const booking = payload.booking;
  const reference = booking.online_booking_references;
  if (reference == null || reference === "") {
    return { kind: "no_reference" };
  }
  if (typeof reference !== "string" || reference.trim() === "") {
    return { kind: "malformed" };
  }

  const itemPk = readItemPk(booking.availability);
  if (itemPk === undefined) {
    return { kind: "ignored", reason: "invalid_payment" };
  }
  if (itemPk !== FAREHARBOR_GIFT_CARD_ITEM_ID) {
    return { kind: "ignored", reason: "wrong_item" };
  }

  const bookingUuid = readUuid(booking.uuid);
  if (!bookingUuid) {
    return { kind: "ignored", reason: "invalid_payment" };
  }

  if (!Array.isArray(booking.payments) || booking.payments.length !== 1) {
    return { kind: "ignored", reason: "invalid_payment" };
  }
  const payment = booking.payments[0];
  if (!isPlainObject(payment) || !Array.isArray(payment.refunds)) {
    return { kind: "ignored", reason: "invalid_payment" };
  }

  const paidAmount = minorUnits(payment.amount_paid);
  if (payment.refunds.length > 0) {
    return {
      kind: "refunded",
      checkoutRef: reference,
      bookingUuid,
      paidAmount,
    };
  }

  if (booking.status !== "booked") {
    return { kind: "ignored", reason: "not_booked" };
  }
  if (
    payment.status !== "succeeded" ||
    payment.type !== "card" ||
    payment.currency !== "cad"
  ) {
    return { kind: "ignored", reason: "invalid_payment" };
  }

  const receiptTotal = minorUnits(booking.receipt_total);
  if (paidAmount === null || receiptTotal !== paidAmount) {
    return { kind: "ignored", reason: "invalid_payment" };
  }

  return {
    kind: "payable",
    checkoutRef: reference,
    bookingUuid,
    paidAmount,
    paidAt: readPaymentCompletedAt(payment.created_at),
  };
}

export function isFareharborGiftCardItem(payload: unknown): boolean {
  if (!isPlainObject(payload) || !isPlainObject(payload.booking)) {
    return false;
  }
  return readItemPk(payload.booking.availability) === FAREHARBOR_GIFT_CARD_ITEM_ID;
}

export function createNamingToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashNamingToken(token) };
}

export function hashNamingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function namingLinkPath(token: string): string {
  return `/name/${encodeURIComponent(token)}`;
}

function readItemPk(availability: unknown): string | undefined {
  if (!isPlainObject(availability) || !isPlainObject(availability.item)) {
    return undefined;
  }
  const pk = availability.item.pk;
  if (typeof pk === "number" && Number.isSafeInteger(pk) && pk >= 0) {
    return String(pk);
  }
  if (typeof pk === "string" && /^[0-9]+$/.test(pk)) {
    return pk;
  }
  return undefined;
}

function readUuid(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const uuid = value.trim();
  if (!uuid || uuid !== value) {
    return undefined;
  }
  return uuid;
}

/**
 * FareHarbor gift-card payments carry `created_at` on the payment itself.
 * Stored item 308290 events use `YYYY-MM-DDTHH:mm:ss±HHMM`, and that value
 * differs from `booking.created_at`. There is no separate completed_at.
 * Booking creation time is intentionally not a fallback.
 */
export function readPaymentCompletedAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return null;
  }
  const matched = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|([+-]\d{2})(:?)(\d{2}))$/.exec(
    value,
  );
  if (!matched) {
    return null;
  }
  const offset = matched[3] === "Z" ? "Z" : `${matched[4]}:${matched[6]}`;
  const parsed = new Date(`${matched[1]}${matched[2] ?? ""}${offset}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function minorUnits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
