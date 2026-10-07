import type { GscReportFamilyId } from "./google-search-console.reports";

export type GscFamilyReplacePlan = {
  family: GscReportFamilyId;
  siteUrl: string;
  replaceDates: string[];
  skippedUnpublishedDates: string[];
};

export function planGscFamilyReplacement(input: {
  family: GscReportFamilyId;
  siteUrl: string;
  publishedDates: readonly string[];
  possiblyUnpublishedDates: readonly string[];
}): GscFamilyReplacePlan {
  return {
    family: input.family,
    siteUrl: input.siteUrl,
    replaceDates: [...input.publishedDates],
    skippedUnpublishedDates: [...input.possiblyUnpublishedDates],
  };
}

export function dateIsInsideReplaceDates(
  date: string,
  replaceDates: readonly string[],
): boolean {
  return replaceDates.includes(date);
}
