import type { GscImportWindowResult } from "./google-search-console-import.service";
import {
  GSC_EARLIEST_USEFUL_DATE,
  GSC_INCREMENTAL_DAY_OFFSETS,
  GSC_REPORTING_TIME_ZONE,
} from "./google-search-console.constants";
import type { GscReconcileVerdict } from "./google-search-console.reconcile";
import { GSC_REPORT_DEFINITIONS } from "./google-search-console.reports";
import {
  addCalendarDays,
  assertGscDate,
  parseGscWindow,
  todayInTimeZone,
} from "./google-search-console.range";
import type { GscDateWindow } from "./google-search-console.types";

export type GscIncrementalSkip = {
  date: string;
  reason: "before_earliest_useful_date";
};

export type GscIncrementalPlan = {
  today: string;
  timeZone: string;
  dryRun: boolean;
  asOf: string | undefined;
  refreshDates: string[];
  skipped: GscIncrementalSkip[];
  families: string[];
  order: "oldest-to-newest";
};

export type GscIncrementalDateReport = {
  date: string;
  families: number;
  published: boolean;
  reconciliation: "PASS" | "FAIL";
  differences: string[];
  diagnostics: string[];
};

export type GscIncrementalResult =
  | {
      ok: true;
      dryRun: boolean;
      plan: GscIncrementalPlan;
      completed: number;
      reports: GscIncrementalDateReport[];
    }
  | {
      ok: false;
      dryRun: boolean;
      plan: GscIncrementalPlan;
      completed: number;
      failedDate?: string;
      message: string;
      reports: GscIncrementalDateReport[];
    };

export type GscIncrementalDeps = {
  importSiteConfig?: () => Promise<{ siteUrl: string }>;
  importWindow: (window: GscDateWindow) => Promise<GscImportWindowResult>;
  reconcileWindow: (imported: GscImportWindowResult) => GscReconcileVerdict;
};

export function parseGscIncrementalArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): GscIncrementalPlan {
  if (parseGscWindow(argv) || argv.includes("--from") || argv.includes("--to")) {
    throw new Error("gsc_incremental_rejects_from_to_use_backfill");
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
        throw new Error("gsc_incremental_as_of_requires_date");
      }
      assertGscDate(asOf);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error("gsc_incremental_unknown_flag");
    }
    throw new Error("gsc_incremental_unknown_flag");
  }
  return planGscIncremental({
    dryRun: argv.includes("--dry-run"),
    timeZone: options.timeZone ?? GSC_REPORTING_TIME_ZONE,
    now: options.now,
    asOf,
  });
}

export function planGscIncremental(input: {
  dryRun: boolean;
  timeZone: string;
  now?: Date;
  asOf?: string;
}): GscIncrementalPlan {
  const today = input.asOf ?? todayInTimeZone(input.timeZone, input.now);
  if (input.asOf) {
    assertGscDate(input.asOf);
  }
  const unique = new Set<string>();
  const skipped: GscIncrementalSkip[] = [];
  for (const offset of GSC_INCREMENTAL_DAY_OFFSETS) {
    const date = addCalendarDays(today, -offset);
    if (date < GSC_EARLIEST_USEFUL_DATE) {
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
    families: GSC_REPORT_DEFINITIONS.map((item) => item.id),
    order: "oldest-to-newest",
  };
}

export function formatGscIncrementalPlan(plan: GscIncrementalPlan): string[] {
  const lines = [
    `GSC incremental today=${plan.today} timezone=${plan.timeZone}${plan.asOf ? ` as-of=${plan.asOf}` : ""}${plan.dryRun ? " dry-run" : ""}`,
    `refresh dates (${plan.refreshDates.length}, ${plan.order}): ${plan.refreshDates.join(", ") || "(none)"}`,
  ];
  for (const skip of plan.skipped) {
    lines.push(`skipped ${skip.date} ${skip.reason}`);
  }
  lines.push(`families (${plan.families.length}): ${plan.families.join(", ")}`);
  lines.push(
    "unpublished empty final dates are skipped without replacing existing canonical grains",
  );
  return lines;
}

export async function runGscIncremental(
  deps: GscIncrementalDeps,
  plan: GscIncrementalPlan,
  log: (message: string) => void = console.log,
): Promise<GscIncrementalResult> {
  for (const line of formatGscIncrementalPlan(plan)) {
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

  if (deps.importSiteConfig) {
    await deps.importSiteConfig();
  }

  const reports: GscIncrementalDateReport[] = [];
  let completed = 0;
  for (const date of plan.refreshDates) {
    const window = { from: date, to: date };
    try {
      const imported = await deps.importWindow(window);
      const verdict = deps.reconcileWindow(imported);
      const published = imported.publishedDates.includes(date);
      const report: GscIncrementalDateReport = {
        date,
        families: imported.families.length,
        published,
        reconciliation: verdict.passed ? "PASS" : "FAIL",
        differences: verdict.differences,
        diagnostics: verdict.diagnostics,
      };
      reports.push(report);
      log(
        `date ${date} ${report.reconciliation} ${published ? "published" : "possibly_unpublished"} families=${report.families}`,
      );
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

  log(`GSC incremental ${completed}/${plan.refreshDates.length} dates PASS`);
  return {
    ok: true,
    dryRun: false,
    plan,
    completed,
    reports,
  };
}
