export const NAMING_HOLD_MS = 30 * 60 * 1000;
export const NAMING_SUBMITTED_NAME_MAX = 40;
export const NAMING_LINK_DELIVERY_STALE_MS = 90_000;
export const NAMING_LINK_DELIVERY_ATTEMPTS = 5;
export const NAMING_LINK_DELIVERY_BACKOFF_MS = 15_000;

export const NAMING_CLOCK = Symbol("NAMING_CLOCK");

export const FAREHARBOR_GIFT_CARD_ITEM_ID = "308290";
export const FAREHARBOR_GIFT_CARD_FLOW = "573099";

const FAREHARBOR_GIFT_CARD_BOOK_URL =
  "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/308290/";

export function fareharborGiftCardCheckoutUrl(checkoutRef: string): string {
  const url = new URL(FAREHARBOR_GIFT_CARD_BOOK_URL);
  url.searchParams.set("full-items", "yes");
  url.searchParams.set("flow", FAREHARBOR_GIFT_CARD_FLOW);
  url.searchParams.set("ref", checkoutRef);
  return url.toString();
}
