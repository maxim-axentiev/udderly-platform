export type MailchimpWindowReconcileTotals = {
  rangeLabel: string;
  audienceCount: number;
  activityRows: number;
  providerActivityCount: number;
  campaignCount: number;
  reportCount: number;
  missingReportCount: number;
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  skippedIncompleteLinkCount?: number;
};

export type MailchimpReconcileVerdict = {
  passed: boolean;
  differences: string[];
  diagnostics: string[];
  totals: MailchimpWindowReconcileTotals;
};

export function evaluateMailchimpWindowReconciliation(
  totals: MailchimpWindowReconcileTotals,
): MailchimpReconcileVerdict {
  const differences: string[] = [];
  if (totals.providerActivityCount !== totals.activityRows) {
    differences.push(
      `activity: provider ${totals.providerActivityCount} != canonical ${totals.activityRows}`,
    );
  }
  const diagnostics: string[] = [];
  for (const date of totals.possiblyUnpublishedDates) {
    diagnostics.push(
      `possibly unpublished list activity date=${date} (not a gate; existing grains were not replaced)`,
    );
  }
  if (totals.missingReportCount > 0) {
    diagnostics.push(
      `missing campaign reports count=${totals.missingReportCount} (not replaced; not a gate)`,
    );
  }
  if ((totals.skippedIncompleteLinkCount ?? 0) > 0) {
    diagnostics.push(
      `incomplete click details count=${totals.skippedIncompleteLinkCount} (existing link rows were not replaced)`,
    );
  }
  return {
    passed: differences.length === 0,
    differences,
    diagnostics,
    totals,
  };
}
