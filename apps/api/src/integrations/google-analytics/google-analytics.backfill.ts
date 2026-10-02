import type { GaImportWindowResult } from "./google-analytics-import.service";
import type { GaReconcileVerdict } from "./google-analytics.reconcile";
import {
  assertHistoricalGaRange,
  parseGaWindow,
  weekChunks,
} from "./google-analytics.range";
import type { GaDateWindow } from "./google-analytics.types";

export const GA_BACKFILL_TIME_ZONE_FALLBACK = "America/Toronto";

export type GaBackfillPlan = {
  from: string;
  to: string;
  dryRun: boolean;
  timeZone: string;
  chunks: GaDateWindow[];
  order: "oldest-to-newest";
};

export type GaBackfillChunkReport = {
  from: string;
  to: string;
  families: Array<{
    family: string;
    requestedRange: string;
    apiRequestCount: number;
    sourceRows: number;
    canonicalRows: number;
    unresolvedRows: number;
    sampled: boolean;
    dataLossFromOtherRow: boolean;
    subjectToThresholding: boolean;
    reconciliation: "PASS" | "FAIL";
  }>;
  reconciliation: "PASS" | "FAIL";
  differences: string[];
};

export type GaBackfillResult =
  | {
      ok: true;
      dryRun: boolean;
      plan: GaBackfillPlan;
      completed: number;
      reports: GaBackfillChunkReport[];
    }
  | {
      ok: false;
      dryRun: boolean;
      plan: GaBackfillPlan;
      completed: number;
      failedChunk?: GaDateWindow;
      message: string;
      reports: GaBackfillChunkReport[];
    };

export type GaBackfillDeps = {
  importAdminConfig?: () => Promise<{ timezone: string }>;
  importWindow: (window: GaDateWindow) => Promise<GaImportWindowResult>;
  reconcileWindow: (imported: GaImportWindowResult) => GaReconcileVerdict;
};

export function parseGaBackfillArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): GaBackfillPlan {
  const window = parseGaWindow(argv);
  if (!window) {
    throw new Error("ga_backfill_requires_from_to");
  }
  return planGaBackfill({
    from: window.from,
    to: window.to,
    dryRun: argv.includes("--dry-run"),
    timeZone: options.timeZone ?? GA_BACKFILL_TIME_ZONE_FALLBACK,
    now: options.now,
  });
}

export function planGaBackfill(input: {
  from: string;
  to: string;
  dryRun: boolean;
  timeZone: string;
  now?: Date;
}): GaBackfillPlan {
  assertHistoricalGaRange(input.from, input.to, input.timeZone, input.now);
  return {
    from: input.from,
    to: input.to,
    dryRun: input.dryRun,
    timeZone: input.timeZone,
    chunks: weekChunks(input.from, input.to),
    order: "oldest-to-newest",
  };
}

export async function runGaBackfill(
  deps: GaBackfillDeps,
  plan: GaBackfillPlan,
  log: (message: string) => void = console.log,
): Promise<GaBackfillResult> {
  log(
    `GA backfill ${plan.from}..${plan.to} (${plan.chunks.length} weekly chunks, ${plan.order}, timezone ${plan.timeZone}${plan.dryRun ? ", dry-run" : ""})`,
  );
  if (plan.dryRun) {
    for (const chunk of plan.chunks) {
      log(`dry-run chunk ${chunk.from}..${chunk.to}`);
    }
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

  const reports: GaBackfillChunkReport[] = [];
  let completed = 0;
  for (const chunk of plan.chunks) {
    try {
      const imported = await deps.importWindow(chunk);
      const verdict = deps.reconcileWindow(imported);
      const report: GaBackfillChunkReport = {
        from: chunk.from,
        to: chunk.to,
        families: imported.families.map((family) => ({
          family: family.family,
          requestedRange: `${family.startDate}/${family.endDate}`,
          apiRequestCount: family.requestCount,
          sourceRows: family.sourceRows,
          canonicalRows: family.canonicalRows,
          unresolvedRows: family.unresolvedRows,
          sampled: family.sampled,
          dataLossFromOtherRow: family.dataLossFromOtherRow,
          subjectToThresholding: family.subjectToThresholding,
          reconciliation: verdict.passed ? "PASS" : "FAIL",
        })),
        reconciliation: verdict.passed ? "PASS" : "FAIL",
        differences: verdict.differences,
      };
      reports.push(report);
      log(
        `chunk ${chunk.from}..${chunk.to} ${report.reconciliation} families=${report.families.length}`,
      );
      if (!verdict.passed) {
        return {
          ok: false,
          dryRun: false,
          plan,
          completed,
          failedChunk: chunk,
          message: verdict.differences.join("; ") || "reconciliation_failed",
          reports,
        };
      }
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`chunk ${chunk.from}..${chunk.to} FAIL ${message}`);
      return {
        ok: false,
        dryRun: false,
        plan,
        completed,
        failedChunk: chunk,
        message,
        reports,
      };
    }
  }

  return {
    ok: true,
    dryRun: false,
    plan,
    completed,
    reports,
  };
}
