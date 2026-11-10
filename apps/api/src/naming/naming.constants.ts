import {
  CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID,
  CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID,
  fareharborCheckoutUrl,
} from "@udderly/shared";

export const NAMING_HOLD_MS = 30 * 60 * 1000;
export const NAMING_SUBMITTED_NAME_MAX = 40;
export const NAMING_LINK_DELIVERY_STALE_MS = 90_000;
export const NAMING_LINK_DELIVERY_ATTEMPTS = 5;
export const NAMING_LINK_DELIVERY_BACKOFF_MS = 15_000;

export const NAMING_CLOCK = Symbol("NAMING_CLOCK");
export const FAREHARBOR_TIER_CHECKOUTS = Symbol("FAREHARBOR_TIER_CHECKOUTS");

/** Confirmed FareHarbor gift-card item. Unset tier config keeps this id. */
export const FAREHARBOR_GIFT_CARD_ITEM_ID = CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID;
/** Confirmed FareHarbor booking flow for item 308290. */
export const FAREHARBOR_GIFT_CARD_FLOW = CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID;

export function fareharborGiftCardCheckoutUrl(checkoutRef: string): string {
  return fareharborCheckoutUrl(
    {
      itemId: FAREHARBOR_GIFT_CARD_ITEM_ID,
      flowId: FAREHARBOR_GIFT_CARD_FLOW,
    },
    checkoutRef,
  );
}
