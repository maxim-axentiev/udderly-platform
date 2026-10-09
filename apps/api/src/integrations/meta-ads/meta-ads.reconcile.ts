import { META_ADS_ATTRIBUTION_WINDOW_ID } from "./meta-ads.constants";
import type { NormalizedMetaAdsFact } from "./meta-ads.normalize";
import type { MetaAdsInsightLevel } from "./meta-ads.types";

export type MetaAdsLevelReconcileTotals = {
  level: MetaAdsInsightLevel;
  startDate: string;
  endDate: string;
  sourceRows: number;
  providerRowCount: number;
  canonicalRows: number;
  unresolvedRows: number;
  requestCount: number;
  attributionWindow: string;
};

export type MetaAdsWindowReconcileTotals = {
  rangeLabel: string;
  levels: MetaAdsLevelReconcileTotals[];
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  accountSpend?: number;
  campaignSpend?: number;
  adsetSpend?: number;
  adSpend?: number;
};

export type MetaAdsReconcileVerdict = {
  passed: boolean;
  differences: string[];
  diagnostics: string[];
  totals: MetaAdsWindowReconcileTotals;
};

export function evaluateMetaAdsLevelReconciliation(
  totals: MetaAdsLevelReconcileTotals,
): string[] {
  const differences: string[] = [];
  if (totals.providerRowCount !== totals.sourceRows) {
    differences.push(
      `${totals.level}: rowCount ${totals.providerRowCount} != source ${totals.sourceRows}`,
    );
  }
  if (totals.sourceRows !== totals.canonicalRows) {
    differences.push(
      `${totals.level}: canonical ${totals.canonicalRows} != source ${totals.sourceRows}`,
    );
  }
  if (totals.unresolvedRows !== 0) {
    differences.push(`${totals.level}: unresolved ${totals.unresolvedRows}`);
  }
  if (totals.attributionWindow !== META_ADS_ATTRIBUTION_WINDOW_ID) {
    differences.push(`${totals.level}: attribution_window_mismatch`);
  }
  return differences;
}

export function evaluateMetaAdsWindowReconciliation(
  totals: MetaAdsWindowReconcileTotals,
): MetaAdsReconcileVerdict {
  const differences = totals.levels.flatMap(evaluateMetaAdsLevelReconciliation);
  const diagnostics: string[] = [];
  for (const date of totals.possiblyUnpublishedDates) {
    diagnostics.push(
      `possibly unpublished insights date=${date} (not a gate; existing canonical grains were not replaced)`,
    );
  }
  pushSpendDiagnostic(diagnostics, "campaign", totals.accountSpend, totals.campaignSpend);
  pushSpendDiagnostic(diagnostics, "adset", totals.accountSpend, totals.adsetSpend);
  pushSpendDiagnostic(diagnostics, "ad", totals.accountSpend, totals.adSpend);
  return {
    passed: differences.length === 0,
    differences,
    diagnostics,
    totals,
  };
}

export function sumSpend(
  facts: readonly NormalizedMetaAdsFact[] | undefined,
): number | undefined {
  if (facts === undefined) {
    return undefined;
  }
  return facts.reduce((total, fact) => total + fact.spendAmount, 0);
}

function pushSpendDiagnostic(
  diagnostics: string[],
  level: string,
  accountSpend: number | undefined,
  levelSpend: number | undefined,
): void {
  if (
    accountSpend !== undefined &&
    levelSpend !== undefined &&
    accountSpend !== levelSpend
  ) {
    diagnostics.push(
      `${level} spend diagnostic account=${accountSpend} ${level}=${levelSpend} (not a gate)`,
    );
  }
}
