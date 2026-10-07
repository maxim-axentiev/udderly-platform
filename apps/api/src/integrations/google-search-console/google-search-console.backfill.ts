import type { GscImportWindowResult } from "./google-search-console-import.service";
import { GSC_REPORTING_TIME_ZONE } from "./google-search-console.constants";
import type { GscReconcileVerdict } from "./google-search-console.reconcile";
import {
  assertHistoricalGscRange,
  parseGscWindow,
  weekChunks,
} from "./google-search-console.range";
import type { GscDateWindow } from "./google-search-console.types";

export type GscBackfillPlan = {
  from: string;
  to: string;
  dryRun: boolean;
  timeZone: string;
  chunks: GscDateWindow[];
  order: "oldest-to-newest";
};

export type GscBackfillChunkReport = {
  from: string;
  to: string;
  families: Array<{
    family: string;
    requestedRange: string;
    apiRequestCount: number;
    sourceRows: number;
    canonicalRows: number;
    unresolvedRows: number;
    reconciliation: "PASS" | "FAIL";
  }>;
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
  reconciliation: "PASS" | "FAIL";
  differences: string[];
};

export type GscBackfillResult =
  | {
      ok: true;
      dryRun: boolean;
      plan: GscBackfillPlan;
      completed: number;
      reports: GscBackfillChunkReport[];
    }
  | {
      ok: false;
      dryRun: boolean;
      plan: GscBackfillPlan;
      completed: number;
      failedChunk?: GscDateWindow;
      message: string;
      reports: GscBackfillChunkReport[];
    };

export type GscBackfillDeps = {
  importSiteConfig?: () => Promise<{ siteUrl: string }>;
  importWindow: (window: GscDateWindow) => Promise<GscImportWindowResult>;
  reconcileWindow: (imported: GscImportWindowResult) => GscReconcileVerdict;
};

export function parseGscBackfillArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): GscBackfillPlan {
  const window = parseGscWindow(argv);
  if (!window) {
    throw new Error("gsc_backfill_requires_from_to");
  }
  return planGscBackfill({
    from: window.from,
    to: window.to,
    dryRun: argv.includes("--dry-run"),
    timeZone: options.timeZone ?? GSC_REPORTING_TIME_ZONE,
    now: options.now,
  });
}

export function planGscBackfill(input: {
  from: string;
  to: string;
  dryRun: boolean;
  timeZone: string;
  now?: Date;
}): GscBackfillPlan {
  assertHistoricalGscRange(input.from, input.to, input.timeZone, input.now);
  return {
    from: input.from,
    to: input.to,
    dryRun: input.dryRun,
    timeZone: input.timeZone,
    chunks: weekChunks(input.from, input.to),
    order: "oldest-to-newest",
  };
}

export function formatGscBackfillPlan(plan: GscBackfillPlan): string[] {
  const lines = [
    `GSC backfill ${plan.from}..${plan.to} (${plan.chunks.length} weekly chunks, ${plan.order}, timezone ${plan.timeZone}${plan.dryRun ? ", dry-run" : ""})`,
  ];
  if (plan.dryRun) {
    for (const chunk of plan.chunks) {
      lines.push(`dry-run chunk ${chunk.from}..${chunk.to}`);
    }
  }
  return lines;
}

export async function runGscBackfill(
  deps: GscBackfillDeps,
  plan: GscBackfillPlan,
  log: (message: string) => void = console.log,
): Promise<GscBackfillResult> {
  for (const line of formatGscBackfillPlan(plan)) {
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

  const reports: GscBackfillChunkReport[] = [];
  let completed = 0;
  for (const chunk of plan.chunks) {
    try {
      const imported = await deps.importWindow(chunk);
      const verdict = deps.reconcileWindow(imported);
      const report: GscBackfillChunkReport = {
        from: chunk.from,
        to: chunk.to,
        families: imported.families.map((family) => ({
          family: family.family,
          requestedRange: `${family.startDate}/${family.endDate}`,
          apiRequestCount: family.requestCount,
          sourceRows: family.sourceRows,
          canonicalRows: family.canonicalRows,
          unresolvedRows: family.unresolvedRows,
          reconciliation: verdict.passed ? "PASS" : "FAIL",
        })),
        publishedDates: imported.publishedDates,
        possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
        reconciliation: verdict.passed ? "PASS" : "FAIL",
        differences: verdict.differences,
      };
      reports.push(report);
      log(
        `chunk ${chunk.from}..${chunk.to} ${report.reconciliation} families=${report.families.length} published=${imported.publishedDates.length} unpublished=${imported.possiblyUnpublishedDates.length}`,
      );
      for (const line of verdict.diagnostics) {
        log(`chunk ${chunk.from}..${chunk.to} ${line}`);
      }
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
