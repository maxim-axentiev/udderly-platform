import { isFareharborCheckoutUrl } from "./format";

export type StoredCheckout = {
  checkoutUrl: string;
  holdExpiresAt: string;
};

function storageKey(reservationId: string): string {
  return `naming-checkout:${reservationId}`;
}

export function parseStoredCheckout(raw: string): StoredCheckout | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCheckout>;
    if (
      typeof parsed.checkoutUrl !== "string" ||
      typeof parsed.holdExpiresAt !== "string" ||
      !isFareharborCheckoutUrl(parsed.checkoutUrl) ||
      Number.isNaN(new Date(parsed.holdExpiresAt).getTime())
    ) {
      return null;
    }
    return {
      checkoutUrl: parsed.checkoutUrl,
      holdExpiresAt: parsed.holdExpiresAt,
    };
  } catch {
    return null;
  }
}

export function rememberCheckout(
  reservationId: string,
  checkout: StoredCheckout,
): void {
  if (!isFareharborCheckoutUrl(checkout.checkoutUrl)) {
    return;
  }
  sessionStorage.setItem(storageKey(reservationId), JSON.stringify(checkout));
}

export function readCheckout(reservationId: string): StoredCheckout | null {
  const raw = sessionStorage.getItem(storageKey(reservationId));
  if (!raw) {
    return null;
  }
  return parseStoredCheckout(raw);
}
