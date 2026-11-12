import type { NamingReviewReason } from "../database/schema/naming";
import { readPaymentCompletedAt } from "./naming-gift-card";

export const staffNamingStates = [
  "available",
  "on_hold",
  "claimed_unnamed",
  "claimed_named",
] as const;

export type StaffNamingState = (typeof staffNamingStates)[number];

export type StaffNamingAttention = "payment_reversed" | "review_required" | null;

export type StaffBookingDetails = {
  purchaserName: string | null;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  orderNumber: string | null;
  purchasedAt: Date | null;
};

export type StaffReservationFacts = {
  status: string;
  reviewReason: string | null;
  submittedName: string | null;
  paidAmount: number | null;
  currency: string;
  claimedAt: Date | null;
};

export type StaffNamingView = {
  state: StaffNamingState;
  attention: StaffNamingAttention;
  reviewReason: NamingReviewReason | null;
  submittedName: string | null;
  purchaserName: string | null;
  purchaserEmail: string | null;
  purchaserPhone: string | null;
  orderNumber: string | null;
  paidAmountCents: number | null;
  currency: string | null;
  purchasedAt: string | null;
};

const REVIEW_REASONS = new Set<NamingReviewReason>([
  "amount_mismatch",
  "late_conflict",
  "duplicate_booking",
  "payment_reversed",
  "underpaid",
  "purchase_after_deadline",
  "payment_time_unverified",
]);

const EMAIL = /^[^@\s]+@[^@\s]+$/;
const PHONE = /^[0-9+().\-\s]{7,40}$/;

/**
 * Reads the contact, order number, and payment time stored on a FareHarbor
 * webhook. Card data and the rest of the payload are dropped.
 */
export function extractStaffBooking(payload: unknown): StaffBookingDetails | null {
  if (!isRecord(payload) || !isRecord(payload.booking)) {
    return null;
  }
  const booking = payload.booking;
  const contact = isRecord(booking.contact) ? booking.contact : undefined;
  const payment = Array.isArray(booking.payments) ? booking.payments[0] : undefined;
  return {
    purchaserName: text(contact?.name, 200),
    purchaserEmail: email(contact?.email),
    purchaserPhone: phone(contact?.phone) ?? phone(contact?.normalized_phone),
    orderNumber: orderNumber(booking),
    purchasedAt: isRecord(payment) ? readPaymentCompletedAt(payment.created_at) : null,
  };
}

export function presentStaffNaming(input: {
  objectStatus: string;
  reservation: StaffReservationFacts | null;
  booking: StaffBookingDetails | null;
  ambiguous?: boolean;
}): StaffNamingView {
  const reservation = input.ambiguous ? null : input.reservation;
  const attention = input.ambiguous
    ? "review_required"
    : namingAttention(reservation);
  const state = namingState(input.objectStatus, reservation);
  const named =
    state === "claimed_named" && reservation?.submittedName
      ? reservation.submittedName
      : null;
  const showBooking =
    !input.ambiguous &&
    reservation !== null &&
    (reservation.status === "claimed" || reservation.status === "needs_review");
  const booking = showBooking ? input.booking : null;
  const paidAmountCents =
    showBooking &&
    reservation &&
    typeof reservation.paidAmount === "number" &&
    Number.isSafeInteger(reservation.paidAmount) &&
    reservation.paidAmount >= 0
      ? reservation.paidAmount
      : null;
  const purchasedAt =
    booking?.purchasedAt ??
    (reservation?.status === "claimed" ? reservation.claimedAt : null);
  return {
    state,
    attention,
    reviewReason: knownReason(reservation?.reviewReason),
    submittedName: named,
    purchaserName: booking?.purchaserName ?? null,
    purchaserEmail: booking?.purchaserEmail ?? null,
    purchaserPhone: booking?.purchaserPhone ?? null,
    orderNumber: booking?.orderNumber ?? null,
    paidAmountCents,
    currency: paidAmountCents === null ? null : reservation?.currency === "CAD" ? "CAD" : null,
    purchasedAt: purchasedAt ? purchasedAt.toISOString() : null,
  };
}

function namingState(
  objectStatus: string,
  reservation: StaffReservationFacts | null,
): StaffNamingState {
  if (objectStatus === "held") {
    return "on_hold";
  }
  if (objectStatus === "claimed") {
    return reservation?.status === "claimed" && reservation.submittedName
      ? "claimed_named"
      : "claimed_unnamed";
  }
  return "available";
}

function namingAttention(
  reservation: StaffReservationFacts | null,
): StaffNamingAttention {
  if (!reservation) {
    return null;
  }
  if (reservation.reviewReason === "payment_reversed") {
    return "payment_reversed";
  }
  if (reservation.status === "needs_review" || reservation.reviewReason) {
    return "review_required";
  }
  return null;
}

function knownReason(value: string | null | undefined): NamingReviewReason | null {
  if (value && REVIEW_REASONS.has(value as NamingReviewReason)) {
    return value as NamingReviewReason;
  }
  return null;
}

function orderNumber(booking: Record<string, unknown>): string | null {
  const pk = booking.pk;
  if (typeof pk === "number" && Number.isSafeInteger(pk) && pk > 0) {
    return String(pk);
  }
  if (typeof pk === "string" && /^[0-9]+$/.test(pk)) {
    return pk;
  }
  if (typeof booking.display_id === "string") {
    const digits = booking.display_id.trim().replace(/^#/, "");
    if (/^[0-9]+$/.test(digits)) {
      return digits;
    }
  }
  return null;
}

function email(value: unknown): string | null {
  const address = text(value, 254);
  if (!address || !EMAIL.test(address)) {
    return null;
  }
  return address;
}

function phone(value: unknown): string | null {
  const number = text(value, 40);
  if (!number || !PHONE.test(number)) {
    return null;
  }
  return number;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || hasUnsafeText(trimmed)) {
    return null;
  }
  return trimmed;
}

function hasUnsafeText(value: string): boolean {
  if (value.includes("<") || value.includes(">")) {
    return true;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
