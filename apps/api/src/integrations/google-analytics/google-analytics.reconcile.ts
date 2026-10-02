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
  diagnostics: string[];
  totals: GaWindowReconcileTotals;
};

const SUMMABLE_METRICS = new Set<string>([
  ...ADDITIVE_DAILY_METRICS,
  "sessions",
  "ecommercePurchases",
]);

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
  const diagnostics: string[] = [];
  if (
    totals.dailySessions !== undefined &&
    totals.acquisitionSessions !== undefined &&
    !numericEqual(totals.dailySessions, totals.acquisitionSessions)
  ) {
    diagnostics.push(
      `sessions diagnostic daily=${totals.dailySessions} acquisition=${totals.acquisitionSessions} (not a gate)`,
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
    diagnostics,
    totals,
  };
}

export function sumMetric(
  facts: NormalizedFact[],
  metric: string,
): string | undefined {
  if (!SUMMABLE_METRICS.has(metric)) {
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
