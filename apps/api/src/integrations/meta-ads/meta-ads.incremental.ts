import type { MetaAdsImportWindowResult } from "./meta-ads-import.service";
import {
  META_ADS_INCREMENTAL_DAY_OFFSETS,
  META_ADS_REPORTING_TIME_ZONE,
} from "./meta-ads.constants";
import type { MetaAdsReconcileVerdict } from "./meta-ads.reconcile";
import { META_ADS_INSIGHT_LEVELS } from "./meta-ads.reports";
import {
  addCalendarDays,
  assertMetaAdsDate,
  parseMetaAdsWindow,
  todayInTimeZone,
} from "./meta-ads.range";
import type { MetaAdsDateWindow } from "./meta-ads.types";

export type MetaAdsIncrementalPlan = {
  today: string;
  timeZone: string;
  dryRun: boolean;
  asOf: string | undefined;
  refreshDates: string[];
  skipped: never[];
  levels: string[];
  order: "oldest-to-newest";
};

export type MetaAdsIncrementalDateReport = {
  date: string;
  levels: number;
  published: boolean;
  replacedDates: string[];
  reconciliation: "PASS" | "FAIL";
  differences: string[];
  diagnostics: string[];
};

export type MetaAdsIncrementalResult =
  | {
      ok: true;
      dryRun: boolean;
      plan: MetaAdsIncrementalPlan;
      completed: number;
      reports: MetaAdsIncrementalDateReport[];
    }
  | {
      ok: false;
      dryRun: boolean;
      plan: MetaAdsIncrementalPlan;
      completed: number;
      failedDate?: string;
      message: string;
      reports: MetaAdsIncrementalDateReport[];
    };

export type MetaAdsIncrementalDeps = {
  importAccountGraph?: () => Promise<{ accountId: string }>;
  importWindow: (window: MetaAdsDateWindow) => Promise<MetaAdsImportWindowResult>;
  reconcileWindow: (imported: MetaAdsImportWindowResult) => MetaAdsReconcileVerdict;
};

export function parseMetaAdsIncrementalArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): MetaAdsIncrementalPlan {
  if (parseMetaAdsWindow(argv) || argv.includes("--from") || argv.includes("--to")) {
    throw new Error("meta_ads_incremental_rejects_from_to_use_import");
  }
  let asOf: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--as-of") {
      asOf = argv[i + 1];
      if (!asOf || asOf.startsWith("--")) {
        throw new Error("meta_ads_incremental_as_of_requires_date");
      }
      assertMetaAdsDate(asOf);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error("meta_ads_incremental_unknown_flag");
    }
    throw new Error("meta_ads_incremental_unknown_flag");
  }
  return planMetaAdsIncremental({
    dryRun: argv.includes("--dry-run"),
    timeZone: options.timeZone ?? META_ADS_REPORTING_TIME_ZONE,
    now: options.now,
    asOf,
  });
}

export function planMetaAdsIncremental(input: {
  dryRun: boolean;
  timeZone: string;
  now?: Date;
  asOf?: string;
}): MetaAdsIncrementalPlan {
  const today = input.asOf ?? todayInTimeZone(input.timeZone, input.now);
  if (input.asOf) {
    assertMetaAdsDate(input.asOf);
  }
  const unique = new Set<string>();
  for (const offset of META_ADS_INCREMENTAL_DAY_OFFSETS) {
    const date = addCalendarDays(today, -offset);
    if (date >= today) {
      continue;
    }
    unique.add(date);
  }
  return {
    today,
    timeZone: input.timeZone,
    dryRun: input.dryRun,
    asOf: input.asOf,
    refreshDates: [...unique].sort(),
    skipped: [],
    levels: [...META_ADS_INSIGHT_LEVELS],
    order: "oldest-to-newest",
  };
}

export function formatMetaAdsIncrementalPlan(plan: MetaAdsIncrementalPlan): string[] {
  const lines = [
    `Meta Ads incremental today=${plan.today} timezone=${plan.timeZone}${plan.asOf ? ` as-of=${plan.asOf}` : ""}${plan.dryRun ? " dry-run" : ""}`,
    `refresh dates (${plan.refreshDates.length}, ${plan.order}): ${plan.refreshDates.join(", ") || "(none)"}`,
    `levels (${plan.levels.length}): ${plan.levels.join(", ")}`,
    "attribution window 7d_click,1d_view is required on every grain",
    "unpublished or incomplete insight levels do not replace existing canonical grains",
  ];
  if (plan.dryRun) {
    lines.push(
      "dry-run is planning-only: no Nest boot, Graph API, token use, DB, or lock",
    );
  }
  return lines;
}

export async function runMetaAdsIncremental(
  deps: MetaAdsIncrementalDeps,
  plan: MetaAdsIncrementalPlan,
  log: (message: string) => void = console.log,
): Promise<MetaAdsIncrementalResult> {
  for (const line of formatMetaAdsIncrementalPlan(plan)) {
    log(line);
  }
  if (plan.dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      completed: 0,
      reports: [],
    };
  }

  if (deps.importAccountGraph) {
    await deps.importAccountGraph();
  }

  const reports: MetaAdsIncrementalDateReport[] = [];
  let completed = 0;
  for (const date of plan.refreshDates) {
    const window = { from: date, to: date };
    try {
      const imported = await deps.importWindow(window);
      const verdict = deps.reconcileWindow(imported);
      const published = imported.publishedDates.includes(date);
      const report: MetaAdsIncrementalDateReport = {
        date,
        levels: imported.levels.length,
        published,
        replacedDates: imported.replacedDates,
        reconciliation: verdict.passed ? "PASS" : "FAIL",
        differences: verdict.differences,
        diagnostics: verdict.diagnostics,
      };
      reports.push(report);
      log(
        `date ${date} ${report.reconciliation} ${published ? "published" : "possibly_unpublished"} levels=${report.levels} replaced=${imported.replacedDates.join(",") || "(none)"}`,
      );
      for (const line of report.diagnostics) {
        log(`date ${date} ${line}`);
      }
      if (!verdict.passed) {
        const message = verdict.differences.join("; ") || "reconciliation_failed";
        log(`date ${date} FAIL ${message}`);
        return {
          ok: false,
          dryRun: false,
          plan,
          completed,
          failedDate: date,
          message,
          reports,
        };
      }
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`date ${date} FAIL ${message}`);
      return {
        ok: false,
        dryRun: false,
        plan,
        completed,
        failedDate: date,
        message,
        reports,
      };
    }
  }

  log(`Meta Ads incremental ${completed}/${plan.refreshDates.length} dates PASS`);
  return {
    ok: true,
    dryRun: false,
    plan,
    completed,
    reports,
  };
}
