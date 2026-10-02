import type { GaImportWindowResult } from "./google-analytics-import.service";
import {
  GA_INCREMENTAL_DAY_OFFSETS,
  GA_EARLIEST_USEFUL_DATE,
} from "./google-analytics.constants";
import type { GaReconcileVerdict } from "./google-analytics.reconcile";
import { GA_REPORT_DEFINITIONS } from "./google-analytics.reports";
import {
  addCalendarDays,
  assertGaDate,
  parseGaWindow,
  todayInTimeZone,
} from "./google-analytics.range";
import type { GaDateWindow } from "./google-analytics.types";

export const GA_INCREMENTAL_TIME_ZONE_FALLBACK = "America/Toronto";

export type GaIncrementalSkip = {
  date: string;
  reason: "before_earliest_useful_date";
};

export type GaIncrementalPlan = {
  today: string;
  timeZone: string;
  dryRun: boolean;
  asOf: string | undefined;
  refreshDates: string[];
  skipped: GaIncrementalSkip[];
  families: string[];
  order: "oldest-to-newest";
};

export type GaIncrementalDateReport = {
  date: string;
  families: number;
  reconciliation: "PASS" | "FAIL";
  differences: string[];
  diagnostics: string[];
};

export type GaIncrementalResult =
  | {
      ok: true;
      dryRun: boolean;
      plan: GaIncrementalPlan;
      completed: number;
      reports: GaIncrementalDateReport[];
    }
  | {
      ok: false;
      dryRun: boolean;
      plan: GaIncrementalPlan;
      completed: number;
      failedDate?: string;
      message: string;
      reports: GaIncrementalDateReport[];
    };

export type GaIncrementalDeps = {
  importAdminConfig?: () => Promise<{ timezone: string }>;
  importWindow: (window: GaDateWindow) => Promise<GaImportWindowResult>;
  reconcileWindow: (imported: GaImportWindowResult) => GaReconcileVerdict;
};

export function parseGaIncrementalArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): GaIncrementalPlan {
  if (parseGaWindow(argv)) {
    throw new Error("ga_incremental_rejects_from_to_use_backfill");
  }
  if (argv.includes("--from") || argv.includes("--to")) {
    throw new Error("ga_incremental_rejects_from_to_use_backfill");
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
        throw new Error("ga_incremental_as_of_requires_date");
      }
      assertGaDate(asOf);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error("ga_incremental_unknown_flag");
    }
    throw new Error("ga_incremental_unknown_flag");
  }
  return planGaIncremental({
    dryRun: argv.includes("--dry-run"),
    timeZone: options.timeZone ?? GA_INCREMENTAL_TIME_ZONE_FALLBACK,
    now: options.now,
    asOf,
  });
}

export function planGaIncremental(input: {
  dryRun: boolean;
  timeZone: string;
  now?: Date;
  asOf?: string;
}): GaIncrementalPlan {
  const today = input.asOf ?? todayInTimeZone(input.timeZone, input.now);
  if (input.asOf) {
    assertGaDate(input.asOf);
  }
  const unique = new Set<string>();
  const skipped: GaIncrementalSkip[] = [];
  for (const offset of GA_INCREMENTAL_DAY_OFFSETS) {
    const date = addCalendarDays(today, -offset);
    if (date < GA_EARLIEST_USEFUL_DATE) {
      skipped.push({ date, reason: "before_earliest_useful_date" });
      continue;
    }
    if (date >= today) {
      continue;
    }
    unique.add(date);
  }
  const refreshDates = [...unique].sort();
  return {
    today,
    timeZone: input.timeZone,
    dryRun: input.dryRun,
    asOf: input.asOf,
    refreshDates,
    skipped,
    families: GA_REPORT_DEFINITIONS.map((item) => item.id),
    order: "oldest-to-newest",
  };
}

export function formatGaIncrementalPlan(plan: GaIncrementalPlan): string[] {
  const lines = [
    `GA incremental today=${plan.today} timezone=${plan.timeZone}${plan.asOf ? ` as-of=${plan.asOf}` : ""}${plan.dryRun ? " dry-run" : ""}`,
    `refresh dates (${plan.refreshDates.length}, ${plan.order}): ${plan.refreshDates.join(", ") || "(none)"}`,
  ];
  for (const skip of plan.skipped) {
    lines.push(`skipped ${skip.date} ${skip.reason}`);
  }
  lines.push(`families (${plan.families.length}): ${plan.families.join(", ")}`);
  return lines;
}

export async function runGaIncremental(
  deps: GaIncrementalDeps,
  plan: GaIncrementalPlan,
  log: (message: string) => void = console.log,
): Promise<GaIncrementalResult> {
  for (const line of formatGaIncrementalPlan(plan)) {
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

  if (deps.importAdminConfig) {
    await deps.importAdminConfig();
  }

  const reports: GaIncrementalDateReport[] = [];
  let completed = 0;
  for (const date of plan.refreshDates) {
    const window = { from: date, to: date };
    try {
      const imported = await deps.importWindow(window);
      const verdict = deps.reconcileWindow(imported);
      const report: GaIncrementalDateReport = {
        date,
        families: imported.families.length,
        reconciliation: verdict.passed ? "PASS" : "FAIL",
        differences: verdict.differences,
        diagnostics: verdict.diagnostics ?? [],
      };
      reports.push(report);
      log(`date ${date} ${report.reconciliation} families=${report.families}`);
      for (const line of report.diagnostics) {
        log(`date ${date} ${line}`);
      }
      if (!verdict.passed) {
        const message =
          verdict.differences.join("; ") || "reconciliation_failed";
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

  log(
    `GA incremental ${completed}/${plan.refreshDates.length} dates PASS`,
  );
  return {
    ok: true,
    dryRun: false,
    plan,
    completed,
    reports,
  };
}
