import type { SquareCommerceImportSummary } from "./square-commerce-import.service";
import type { SquareCommerceNormalizeSummary } from "./square-commerce-normalize.service";
import type { SquareCommerceReconcileVerdict } from "./square.commerce.reconcile";
import type { SquareFarmWindow } from "./square.range";

export type SquareCommerceBackfillChunk = { from: string; to: string };

export type SquareCommerceBackfillPlan = {
  from: string;
  to: string;
  dryRun: boolean;
};

export type SquareCommerceBackfillStep = "import" | "normalize" | "reconcile";

export type SquareCommerceBackfillResult =
  | {
      ok: true;
      dryRun: boolean;
      chunks: SquareCommerceBackfillChunk[];
      completed: number;
    }
  | {
      ok: false;
      dryRun: false;
      chunks: SquareCommerceBackfillChunk[];
      completed: number;
      failedChunk: SquareCommerceBackfillChunk;
      failedStep: SquareCommerceBackfillStep;
      message: string;
    };

export type SquareCommerceBackfillDeps = {
  importWindow: (
    window: SquareFarmWindow,
  ) => Promise<SquareCommerceImportSummary>;
  normalizeWindow: (
    window: SquareFarmWindow,
  ) => Promise<SquareCommerceNormalizeSummary>;
  reconcileWindow: (
    window: SquareFarmWindow,
  ) => Promise<SquareCommerceReconcileVerdict>;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSquareCommerceBackfillArgs(
  argv: string[],
): SquareCommerceBackfillPlan | undefined {
  let from: string | undefined;
  let to: string | undefined;
  let dryRun = false;
  let date: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--date") {
      date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--from") {
      from = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
      continue;
    }
    if (arg === "--to") {
      to = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    }
  }

  const trimmedFrom = from?.trim();
  const trimmedTo = to?.trim();
  if (date?.trim()) {
    return undefined;
  }
  if (
    !trimmedFrom ||
    !trimmedTo ||
    !DATE.test(trimmedFrom) ||
    !DATE.test(trimmedTo) ||
    trimmedFrom > trimmedTo
  ) {
    return undefined;
  }
  return { from: trimmedFrom, to: trimmedTo, dryRun };
}

/**
 * Inclusive America/Toronto farm-calendar months, newest to oldest.
 * Mid-month --from/--to clip the first and last chunks.
 */
export function squareCommerceMonthChunks(
  from: string,
  to: string,
): SquareCommerceBackfillChunk[] {
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    throw new Error("invalid_date");
  }

  const chunks: SquareCommerceBackfillChunk[] = [];
  let year = Number(to.slice(0, 4));
  let month = Number(to.slice(5, 7));
  const fromYear = Number(from.slice(0, 4));
  const fromMonth = Number(from.slice(5, 7));

  while (year > fromYear || (year === fromYear && month >= fromMonth)) {
    const monthStart = ymd(year, month, 1);
    const monthEnd = lastDayOfMonth(year, month);
    const chunkFrom = from > monthStart ? from : monthStart;
    const chunkTo = to < monthEnd ? to : monthEnd;
    if (chunkFrom <= chunkTo) {
      chunks.push({ from: chunkFrom, to: chunkTo });
    }
    if (month === 1) {
      year -= 1;
      month = 12;
    } else {
      month -= 1;
    }
  }

  return chunks;
}

export function formatSquareCommerceBackfillDryRun(
  plan: SquareCommerceBackfillPlan,
): string {
  const chunks = squareCommerceMonthChunks(plan.from, plan.to);
  return [
    "Square commerce historical backfill",
    "",
    "Requested range:",
    `${plan.from} to ${plan.to}`,
    "",
    "Chunks:",
    ...chunks.map((chunk) => `${chunk.from} to ${chunk.to}`),
    "",
    "Dry run only. No data changed.",
  ].join("\n");
}

export async function runSquareCommerceBackfill(
  deps: SquareCommerceBackfillDeps,
  plan: SquareCommerceBackfillPlan,
  log: (line: string) => void = console.log,
): Promise<SquareCommerceBackfillResult> {
  const chunks = squareCommerceMonthChunks(plan.from, plan.to);

  if (plan.dryRun) {
    log(formatSquareCommerceBackfillDryRun(plan));
    return { ok: true, dryRun: true, chunks, completed: 0 };
  }

  let completed = 0;
  for (const chunk of chunks) {
    const window: SquareFarmWindow = { from: chunk.from, to: chunk.to };
    log("=================================");
    log("Square backfill");
    log(`${chunk.from} to ${chunk.to}`);
    log("=================================");
    log("");

    let imported: SquareCommerceImportSummary;
    try {
      imported = await deps.importWindow(window);
    } catch (error) {
      return fail(chunks, completed, chunk, "import", error, log);
    }
    log("Import");
    log(`Orders fetched: ${imported.ordersFetched}`);
    log(`Payments fetched: ${imported.paymentsFetched}`);
    log(`Refunds fetched: ${imported.refundsFetched}`);
    log(`Snapshots inserted: ${imported.snapshotsInserted}`);
    log(`Snapshots unchanged: ${imported.snapshotsUnchanged}`);
    log("");

    let normalized: SquareCommerceNormalizeSummary;
    try {
      normalized = await deps.normalizeWindow(window);
    } catch (error) {
      return fail(chunks, completed, chunk, "normalize", error, log);
    }
    log("Normalize");
    log(`Sales: ${normalized.sales}`);
    log(`Line items: ${normalized.lineItems}`);
    log(`Custom/non-catalog lines: ${normalized.customNonCatalogLines}`);
    log(`Unresolved catalog lines: ${normalized.unresolvedCatalogLines}`);
    log(`Payments: ${normalized.payments}`);
    log(`Refunds: ${normalized.refunds}`);
    log(`Return-only orders skipped: ${normalized.returnOnlyOrdersSkipped}`);
    log(
      `Return-adjustment non-sales skipped: ${normalized.returnAdjustmentNonSalesSkipped}`,
    );
    log(`Invalid order money skipped: ${normalized.invalidOrderMoneySkipped}`);
    log(`Unresolved payments: ${normalized.unresolvedPayments}`);
    log(
      `Failed non-settled payment attempts skipped: ${normalized.failedNonSettledPaymentAttemptsSkipped}`,
    );
    log(`Dependency orders applied: ${normalized.dependencyOrdersApplied}`);
    log(`Unresolved refunds: ${normalized.unresolvedRefunds}`);
    log(
      `Net fee credits not representable: ${normalized.invalidProcessingFees}`,
    );
    log("");

    let verdict: SquareCommerceReconcileVerdict;
    try {
      verdict = await deps.reconcileWindow(window);
    } catch (error) {
      return fail(chunks, completed, chunk, "reconcile", error, log);
    }
    log("Reconcile");
    log(`Result: ${verdict.passed ? "PASS" : "FAIL"}`);
    if (!verdict.passed) {
      const message = `reconciliation FAIL for ${chunk.from} to ${chunk.to}`;
      log(`Failed chunk: ${chunk.from} to ${chunk.to}`);
      for (const difference of verdict.differences) {
        log(`- ${difference}`);
      }
      return {
        ok: false,
        dryRun: false,
        chunks,
        completed,
        failedChunk: chunk,
        failedStep: "reconcile",
        message,
      };
    }
    log("");
    completed += 1;
  }

  return { ok: true, dryRun: false, chunks, completed };
}

function fail(
  chunks: SquareCommerceBackfillChunk[],
  completed: number,
  chunk: SquareCommerceBackfillChunk,
  failedStep: SquareCommerceBackfillStep,
  error: unknown,
  log: (line: string) => void,
): SquareCommerceBackfillResult {
  const message = error instanceof Error ? error.message : `${failedStep} failed`;
  log(`${capitalize(failedStep)} failed: ${message}`);
  log(`Failed chunk: ${chunk.from} to ${chunk.to}`);
  return {
    ok: false,
    dryRun: false,
    chunks,
    completed,
    failedChunk: chunk,
    failedStep,
    message,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
