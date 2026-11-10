export const PLATFORM_NAME = "Udderly Platform";

export const PLATFORM_DESCRIPTION =
  "Private business operations platform";

export type HealthStatus = "ok" | "degraded" | "error";

export type HealthResponse = {
  status: HealthStatus;
};

export {
  CONFIRMED_FAREHARBOR_GIFT_CARD_FLOW_ID,
  CONFIRMED_FAREHARBOR_GIFT_CARD_ITEM_ID,
  FareharborTierConfigError,
  NAMING_CAMPAIGN_TIER_CENTS,
  defaultFareharborTierCheckouts,
  expectedFareharborItemId,
  fareharborAcceptedItemIds,
  fareharborCheckoutPairs,
  fareharborCheckoutUrl,
  fareharborConfiguredItemIds,
  fareharborTierCheckoutForPrice,
  isFareharborCheckoutUrl,
  parseFareharborTierCheckouts,
} from "./fareharbor-tiers";
export type { FareharborTierCheckout } from "./fareharbor-tiers";
