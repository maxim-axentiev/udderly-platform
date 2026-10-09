import {
  META_ADS_ATTRIBUTION_WINDOW_ID,
  META_ADS_CANONICAL_CURRENCY,
  META_ADS_REPORTING_TIME_ZONE,
} from "./meta-ads.constants";

export function qualityFailure(input: {
  attributionWindow?: string;
  currency?: string;
  timezone?: string;
}): string | undefined {
  if (
    input.attributionWindow !== undefined &&
    input.attributionWindow !== META_ADS_ATTRIBUTION_WINDOW_ID
  ) {
    return "meta_ads_attribution_window_mismatch";
  }
  if (input.currency !== undefined && input.currency !== META_ADS_CANONICAL_CURRENCY) {
    return "meta_ads_currency_not_cad";
  }
  if (
    input.timezone !== undefined &&
    input.timezone !== META_ADS_REPORTING_TIME_ZONE
  ) {
    return "meta_ads_timezone_not_toronto";
  }
  return undefined;
}

export function assertInsightQuality(input: {
  attributionWindow: string;
  currency: string;
  timezone: string;
}): void {
  const error = qualityFailure(input);
  if (error) {
    throw new Error(error);
  }
}
