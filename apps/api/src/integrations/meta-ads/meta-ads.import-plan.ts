import {
  META_ADS_CANONICAL_ACCOUNT_ID,
  META_ADS_REPORTING_TIME_ZONE,
} from "./meta-ads.constants";
import {
  assertHistoricalMetaAdsRange,
  parseMetaAdsWindow,
} from "./meta-ads.range";
import { META_ADS_INSIGHT_LEVELS } from "./meta-ads.reports";

export type MetaAdsImportPlan = {
  dryRun: boolean;
  accountOnly: boolean;
  from?: string;
  to?: string;
  timeZone: string;
  accountId: string;
  levels: string[];
};

export function parseMetaAdsImportArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): MetaAdsImportPlan {
  const accountOnly = argv.includes("--account-only");
  const dryRun = argv.includes("--dry-run");
  const window = parseMetaAdsWindow(argv);
  if (!accountOnly && !window) {
    throw new Error("meta_ads_import_requires_from_to_or_account_only");
  }
  if (window) {
    assertHistoricalMetaAdsRange(
      window.from,
      window.to,
      options.timeZone ?? META_ADS_REPORTING_TIME_ZONE,
      options.now,
    );
  }
  for (const arg of argv) {
    if (
      arg !== "--dry-run" &&
      arg !== "--account-only" &&
      arg !== "--from" &&
      arg !== "--to" &&
      arg.startsWith("--")
    ) {
      throw new Error("meta_ads_import_unknown_flag");
    }
  }
  return {
    dryRun,
    accountOnly,
    from: window?.from,
    to: window?.to,
    timeZone: options.timeZone ?? META_ADS_REPORTING_TIME_ZONE,
    accountId: META_ADS_CANONICAL_ACCOUNT_ID,
    levels: [...META_ADS_INSIGHT_LEVELS],
  };
}

export function formatMetaAdsImportPlan(plan: MetaAdsImportPlan): string[] {
  const lines = [
    `Meta Ads import account=${plan.accountId} timezone=${plan.timeZone}${plan.dryRun ? " dry-run" : ""}`,
  ];
  if (plan.accountOnly) {
    lines.push("mode=account-only");
  }
  if (plan.from && plan.to) {
    lines.push(`range ${plan.from}..${plan.to}`);
  }
  lines.push(`levels (${plan.levels.length}): ${plan.levels.join(", ")}`);
  if (plan.dryRun) {
    lines.push(
      "dry-run is planning-only: no Nest boot, Graph API, token use, DB, or lock",
    );
    lines.push(
      "empty insight dates with no returned rows are possibly unpublished and will not replace canonical grains",
    );
  }
  return lines;
}
