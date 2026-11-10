import { createServerFn } from "@tanstack/react-start";
import {
  fareharborCheckoutPairs,
  parseFareharborTierCheckouts,
} from "@udderly/shared";

export const loadFareharborCheckoutAllowList = createServerFn({ method: "GET" }).handler(
  () => {
    try {
      return fareharborCheckoutPairs(
        parseFareharborTierCheckouts(process.env.NAMING_FAREHARBOR_TIERS),
      );
    } catch {
      return [];
    }
  },
);
