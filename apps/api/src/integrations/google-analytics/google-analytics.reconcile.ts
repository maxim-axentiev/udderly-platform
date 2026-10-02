import { qualityFailure } from "./google-analytics.quality";
import { ADDITIVE_DAILY_METRICS } from "./google-analytics.reports";
import type { NormalizedFact } from "./google-analytics.normalize";

export type GaFamilyReconcileTotals = {
  family: string;
  startDate: string;
  endDate: string;
  sourceRows: number;
  providerRowCount: number;
  canonicalRows: number;
  unresolvedRows: number;
  requestCount: number;
  sampled: boolean;
  dataLossFromOtherRow: boolean;
  subjectToThresholding: boolean;
};

export type GaWindowReconcileTotals = {
  rangeLabel: string;
  families: GaFamilyReconcileTotals[];
  dailySessions?: string;
  acquisitionSessions?: string;
  eventCount?: string;
  eventFamilyEventCount?: string;
  ecommercePurchases?: string;
};

export type GaReconcileVerdict = {
  passed: boolean;
  differences: string[];
  totals: GaWindowReconcileTotals;
};

export function evaluateGaFamilyReconciliation(
  totals: GaFamilyReconcileTotals,
): string[] {
  const differences: string[] = [];
  const qualityError = qualityFailure({
    sampled: totals.sampled,
    dataLossFromOtherRow: totals.dataLossFromOtherRow,
    subjectToThresholding: totals.subjectToThresholding,
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

export function evaluateGaWindowReconciliation(
  totals: GaWindowReconcileTotals,
): GaReconcileVerdict {
  const differences = totals.families.flatMap(evaluateGaFamilyReconciliation);
  if (
    totals.dailySessions !== undefined &&
    totals.acquisitionSessions !== undefined &&
    !numericEqual(totals.dailySessions, totals.acquisitionSessions)
  ) {
    differences.push(
      `sessions daily ${totals.dailySessions} != acquisition ${totals.acquisitionSessions}`,
    );
  }
  if (
    totals.eventCount !== undefined &&
    totals.eventFamilyEventCount !== undefined &&
    !numericEqual(totals.eventCount, totals.eventFamilyEventCount)
  ) {
    differences.push(
      `eventCount daily ${totals.eventCount} != events ${totals.eventFamilyEventCount}`,
    );
  }
  return {
    passed: differences.length === 0,
    differences,
    totals,
  };
}

export function sumMetric(
  facts: NormalizedFact[],
  metric: string,
): string | undefined {
  if (!ADDITIVE_DAILY_METRICS.includes(metric as never) && metric !== "ecommercePurchases") {
    return undefined;
  }
  let total = 0;
  let seen = false;
  for (const fact of facts) {
    const value = fact.metrics[metric];
    if (value === undefined) {
      continue;
    }
    seen = true;
    total += Number(value);
  }
  return seen ? String(total) : undefined;
}

function numericEqual(left: string, right: string): boolean {
  return Number(left) === Number(right);
}
