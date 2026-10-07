import {
  GSC_CANONICAL_SITE_URL,
  GSC_REPORTING_TIME_ZONE,
} from "./google-search-console.constants";
import { GSC_REPORT_DEFINITIONS } from "./google-search-console.reports";
import {
  assertHistoricalGscRange,
  parseGscWindow,
} from "./google-search-console.range";

export type GscImportPlan = {
  dryRun: boolean;
  siteOnly: boolean;
  from?: string;
  to?: string;
  timeZone: string;
  siteUrl: string;
  families: string[];
};

export function parseGscImportArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): GscImportPlan {
  const siteOnly = argv.includes("--site-only");
  const dryRun = argv.includes("--dry-run");
  const window = parseGscWindow(argv);
  if (!siteOnly && !window) {
    throw new Error("gsc_import_requires_from_to_or_site_only");
  }
  if (window) {
    assertHistoricalGscRange(
      window.from,
      window.to,
      options.timeZone ?? GSC_REPORTING_TIME_ZONE,
      options.now,
    );
  }
  for (const arg of argv) {
    if (
      arg !== "--dry-run" &&
      arg !== "--site-only" &&
      arg !== "--from" &&
      arg !== "--to" &&
      arg.startsWith("--")
    ) {
      throw new Error("gsc_import_unknown_flag");
    }
  }
  return {
    dryRun,
    siteOnly,
    from: window?.from,
    to: window?.to,
    timeZone: options.timeZone ?? GSC_REPORTING_TIME_ZONE,
    siteUrl: GSC_CANONICAL_SITE_URL,
    families: GSC_REPORT_DEFINITIONS.map((item) => item.id),
  };
}

export function formatGscImportPlan(plan: GscImportPlan): string[] {
  const lines = [
    `GSC import site=${plan.siteUrl} timezone=${plan.timeZone}${plan.dryRun ? " dry-run" : ""}`,
  ];
  if (plan.siteOnly) {
    lines.push("mode=site-only");
  }
  if (plan.from && plan.to) {
    lines.push(`range ${plan.from}..${plan.to}`);
  }
  lines.push(`families (${plan.families.length}): ${plan.families.join(", ")}`);
  if (plan.dryRun) {
    lines.push(
      "dry-run is planning-only: no Nest boot, Google API, token refresh, DB, or lock",
    );
    lines.push(
      "empty final dates with no returned rows are possibly unpublished and will not replace canonical grains",
    );
  }
  return lines;
}
