import { qualityFailure } from "./google-search-console.quality";
import type { NormalizedGscFact } from "./google-search-console.normalize";

export type GscFamilyReconcileTotals = {
  family: string;
  startDate: string;
  endDate: string;
  sourceRows: number;
  providerRowCount: number;
  canonicalRows: number;
  unresolvedRows: number;
  requestCount: number;
  dataState: string;
  searchType: string;
};

export type GscWindowReconcileTotals = {
  rangeLabel: string;
  families: GscFamilyReconcileTotals[];
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  dailyClicks?: string;
  dailyImpressions?: string;
  queryClicks?: string;
  queryImpressions?: string;
  pageClicks?: string;
  pageImpressions?: string;
  countryClicks?: string;
  countryImpressions?: string;
  deviceClicks?: string;
  deviceImpressions?: string;
  searchAppearanceClicks?: string;
  searchAppearanceImpressions?: string;
};

export type GscReconcileVerdict = {
  passed: boolean;
  differences: string[];
  diagnostics: string[];
  totals: GscWindowReconcileTotals;
};

export function evaluateGscFamilyReconciliation(
  totals: GscFamilyReconcileTotals,
): string[] {
  const differences: string[] = [];
  const qualityError = qualityFailure({
    dataState: totals.dataState,
    searchType: totals.searchType,
  });
  if (qualityError) {
    differences.push(`${totals.family}: ${qualityError}`);
  }
  if (totals.providerRowCount !== totals.sourceRows) {
    differences.push(
      `${totals.family}: rowCount ${totals.providerRowCount} != source ${totals.sourceRows}`,
    );
  }
  if (totals.sourceRows !== totals.canonicalRows) {
    differences.push(
      `${totals.family}: canonical ${totals.canonicalRows} != source ${totals.sourceRows}`,
    );
  }
  if (totals.unresolvedRows !== 0) {
    differences.push(`${totals.family}: unresolved ${totals.unresolvedRows}`);
  }
  return differences;
}

export function evaluateGscWindowReconciliation(
  totals: GscWindowReconcileTotals,
): GscReconcileVerdict {
  const differences = totals.families.flatMap(evaluateGscFamilyReconciliation);
  const diagnostics: string[] = [];
  for (const date of totals.possiblyUnpublishedDates) {
    diagnostics.push(
      `possibly unpublished final date=${date} (not a gate; existing canonical grains were not replaced)`,
    );
  }
  pushInequalityDiagnostic(
    diagnostics,
    "query",
    totals.dailyClicks,
    totals.dailyImpressions,
    totals.queryClicks,
    totals.queryImpressions,
  );
  pushInequalityDiagnostic(
    diagnostics,
    "page",
    totals.dailyClicks,
    totals.dailyImpressions,
    totals.pageClicks,
    totals.pageImpressions,
  );
  pushInequalityDiagnostic(
    diagnostics,
    "search_appearance",
    totals.dailyClicks,
    totals.dailyImpressions,
    totals.searchAppearanceClicks,
    totals.searchAppearanceImpressions,
  );
  pushInequalityDiagnostic(
    diagnostics,
    "country",
    totals.dailyClicks,
    totals.dailyImpressions,
    totals.countryClicks,
    totals.countryImpressions,
  );
  pushInequalityDiagnostic(
    diagnostics,
    "device",
    totals.dailyClicks,
    totals.dailyImpressions,
    totals.deviceClicks,
    totals.deviceImpressions,
  );
  return {
    passed: differences.length === 0,
    differences,
    diagnostics,
    totals,
  };
}

export function sumMetric(
  facts: readonly NormalizedGscFact[] | undefined,
  metric: "clicks" | "impressions",
): string | undefined {
  if (facts === undefined) {
    return undefined;
  }
  let total = 0;
  for (const fact of facts) {
    total += Number(fact.metrics[metric]);
  }
  return String(total);
}

function pushInequalityDiagnostic(
  diagnostics: string[],
  family: string,
  dailyClicks: string | undefined,
  dailyImpressions: string | undefined,
  familyClicks: string | undefined,
  familyImpressions: string | undefined,
): void {
  if (
    dailyClicks !== undefined &&
    familyClicks !== undefined &&
    !numericEqual(dailyClicks, familyClicks)
  ) {
    diagnostics.push(
      `${family} clicks diagnostic daily=${dailyClicks} ${family}=${familyClicks} (not a gate)`,
    );
  }
  if (
    dailyImpressions !== undefined &&
    familyImpressions !== undefined &&
    !numericEqual(dailyImpressions, familyImpressions)
  ) {
    diagnostics.push(
      `${family} impressions diagnostic daily=${dailyImpressions} ${family}=${familyImpressions} (not a gate)`,
    );
  }
}

function numericEqual(left: string, right: string): boolean {
  return Number(left) === Number(right);
}
