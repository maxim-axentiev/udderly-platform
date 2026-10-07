import { GSC_DATA_STATE } from "./google-search-console.constants";

export function gscScopedExternalId(
  siteUrl: string,
  ...parts: string[]
): string {
  return [siteUrl, ...parts].join(":");
}

export function gscReportExternalId(
  siteUrl: string,
  family: string,
  startDate: string,
  endDate: string,
): string {
  return gscScopedExternalId(
    siteUrl,
    family,
    startDate,
    endDate,
    GSC_DATA_STATE,
  );
}

export function gscSiteExternalId(siteUrl: string): string {
  return siteUrl;
}
