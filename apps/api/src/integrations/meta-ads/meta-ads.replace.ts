import type { MetaAdsInsightLevel } from "./meta-ads.types";

export type MetaAdsFamilyReplacePlan = {
  level: MetaAdsInsightLevel;
  accountId: string;
  replaceDates: string[];
  skippedUnpublishedDates: string[];
};

export function planMetaAdsFamilyReplacement(input: {
  level: MetaAdsInsightLevel;
  accountId: string;
  publishedDates: readonly string[];
  possiblyUnpublishedDates: readonly string[];
}): MetaAdsFamilyReplacePlan {
  return {
    level: input.level,
    accountId: input.accountId,
    replaceDates: [...input.publishedDates],
    skippedUnpublishedDates: [...input.possiblyUnpublishedDates],
  };
}
