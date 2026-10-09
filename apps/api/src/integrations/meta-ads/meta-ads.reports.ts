import type { MetaAdsInsightLevel } from "./meta-ads.types";

export const META_ADS_INSIGHT_LEVELS: readonly MetaAdsInsightLevel[] = [
  "account",
  "campaign",
  "adset",
  "ad",
];

export function insightLevel(value: string): MetaAdsInsightLevel {
  const found = META_ADS_INSIGHT_LEVELS.find((item) => item === value);
  if (!found) {
    throw new Error("unknown_insight_level");
  }
  return found;
}
