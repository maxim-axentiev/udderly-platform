import { META_ADS_ATTRIBUTION_WINDOW_ID } from "./meta-ads.constants";
import type { MetaAdsInsightLevel } from "./meta-ads.types";

export function metaAdsAccountExternalId(accountId: string): string {
  return accountId;
}

export function metaAdsInsightExternalId(
  accountId: string,
  level: MetaAdsInsightLevel,
  startDate: string,
  endDate: string,
): string {
  return [
    accountId,
    level,
    startDate,
    endDate,
    META_ADS_ATTRIBUTION_WINDOW_ID,
  ].join(":");
}

export function metaAdsObjectExternalId(
  accountId: string,
  entityType: string,
  objectId: string,
): string {
  return [accountId, entityType, objectId].join(":");
}
