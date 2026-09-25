import type { SquareCatalogNormalizeSummary } from "./square-catalog-normalize.service";
import type { SquareCatalogRecoveryResult } from "./square-catalog-recovery.service";
import type { SquareCommerceImportSummary } from "./square-commerce-import.service";
import type { SquareCommerceNormalizeSummary } from "./square-commerce-normalize.service";
import type { SquarePaymentOrderRecoveryResult } from "./square-payment-order-recovery.service";
import type { CatalogRecoveryDiscovery } from "./square.catalog.recovery";
import type { PaymentOrderRecoveryDiscovery } from "./square.commerce.payment-order-recovery";
import type { SquareCommerceReconcileVerdict } from "./square.commerce.reconcile";
import type { SquareFarmWindow } from "./square.range";

export type SquareCommerceBackfillChunk = { from: string; to: string };

export type SquareCommerceBackfillPlan = {
  from: string;
  to: string;
  dryRun: boolean;
};

export type SquareCommerceBackfillStep =
  | "import"
  | "normalize"
  | "reconcile"
  | "catalog-recovery"
  | "payment-order-recovery";

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
  discoverCatalogWindow?: (
    window: SquareFarmWindow,
  ) => Promise<CatalogRecoveryDiscovery>;
  recoverCatalogWindow?: (
    window: SquareFarmWindow,
  ) => Promise<SquareCatalogRecoveryResult>;
  normalizeCatalogLatest?: () => Promise<SquareCatalogNormalizeSummary>;
  discoverPaymentOrderWindow?: (
    window: SquareFarmWindow,
  ) => Promise<PaymentOrderRecoveryDiscovery>;
  recoverPaymentOrderWindow?: (
    window: SquareFarmWindow,
  ) => Promise<SquarePaymentOrderRecoveryResult>;
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

export function shouldAttemptCatalogRecovery(
  verdict: SquareCommerceReconcileVerdict,
  alreadyAttempted: boolean,
): boolean {
  return !alreadyAttempted && verdict.totals.unresolvedVariations > 0;
}

export function shouldAttemptPaymentOrderRecovery(
  verdict: SquareCommerceReconcileVerdict,
  alreadyAttempted: boolean,
): boolean {
  return (
    !alreadyAttempted &&
    verdict.totals.canonicalizableSourcePayments !==
      verdict.totals.canonicalPayments
  );
}

export function catalogRecoveryCannotFulfill(
  result: SquareCatalogRecoveryResult,
): boolean {
  const persist = result.persist;
  if (!persist) {
    return true;
  }
  return persist.missingObjects > 0 || persist.unexpectedObjectTypes > 0;
}

export function paymentOrderRecoveryCannotFulfill(
  result: SquarePaymentOrderRecoveryResult,
): boolean {
  const persist = result.persist;
  if (!persist) {
    return true;
  }
  return persist.ordersMissing > 0;
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

    try {
      const imported = await deps.importWindow(window);
      log("Initial import");
      logImport(imported, log);
    } catch (error) {
      return fail(chunks, completed, chunk, "import", error, log);
    }

    let normalized: SquareCommerceNormalizeSummary;
    try {
      normalized = await deps.normalizeWindow(window);
      log("Initial normalize");
      logNormalize(normalized, log);
    } catch (error) {
      return fail(chunks, completed, chunk, "normalize", error, log);
    }

    let verdict: SquareCommerceReconcileVerdict;
    try {
      verdict = await deps.reconcileWindow(window);
      log("Initial reconcile");
      logReconcile(verdict, log);
    } catch (error) {
      return fail(chunks, completed, chunk, "reconcile", error, log);
    }

    let catalogAttempted = false;
    let paymentAttempted = false;

    while (!verdict.passed) {
      const catalogEligible = shouldAttemptCatalogRecovery(
        verdict,
        catalogAttempted,
      );
      const paymentEligible = shouldAttemptPaymentOrderRecovery(
        verdict,
        paymentAttempted,
      );

      if (catalogEligible && deps.discoverCatalogWindow && deps.recoverCatalogWindow) {
        catalogAttempted = true;
        let discovery: CatalogRecoveryDiscovery;
        try {
          discovery = await deps.discoverCatalogWindow(window);
        } catch (error) {
          return fail(chunks, completed, chunk, "catalog-recovery", error, log);
        }
        if (discovery.pairs.length === 0) {
          continue;
        }
        let recovered: SquareCatalogRecoveryResult;
        try {
          recovered = await deps.recoverCatalogWindow(window);
        } catch (error) {
          return fail(chunks, completed, chunk, "catalog-recovery", error, log);
        }
        log("Automatic catalog recovery");
        logCatalogRecovery(recovered.discovery, recovered.persist, log);
        if (catalogRecoveryCannotFulfill(recovered)) {
          return fail(
            chunks,
            completed,
            chunk,
            "catalog-recovery",
            new Error(
              `catalog recovery cannot resolve exact object/version dependencies for ${chunk.from} to ${chunk.to}`,
            ),
            log,
          );
        }
        if (deps.normalizeCatalogLatest) {
          try {
            await deps.normalizeCatalogLatest();
          } catch (error) {
            return fail(chunks, completed, chunk, "catalog-recovery", error, log);
          }
        }
        const retried = await retryNormalizeReconcile(
          deps,
          window,
          chunk,
          chunks,
          completed,
          log,
        );
        if (!retried.ok) {
          return retried.result;
        }
        verdict = retried.verdict;
        continue;
      }

      if (
        paymentEligible &&
        deps.discoverPaymentOrderWindow &&
        deps.recoverPaymentOrderWindow
      ) {
        paymentAttempted = true;
        let discovery: PaymentOrderRecoveryDiscovery;
        try {
          discovery = await deps.discoverPaymentOrderWindow(window);
        } catch (error) {
          return fail(
            chunks,
            completed,
            chunk,
            "payment-order-recovery",
            error,
            log,
          );
        }
        if (discovery.distinctMissingOrderIds.length === 0) {
          continue;
        }
        let recovered: SquarePaymentOrderRecoveryResult;
        try {
          recovered = await deps.recoverPaymentOrderWindow(window);
        } catch (error) {
          return fail(
            chunks,
            completed,
            chunk,
            "payment-order-recovery",
            error,
            log,
          );
        }
        log("Automatic payment-order recovery");
        logPaymentOrderRecovery(recovered.discovery, recovered.persist, log);
        if (paymentOrderRecoveryCannotFulfill(recovered)) {
          return fail(
            chunks,
            completed,
            chunk,
            "payment-order-recovery",
            new Error(
              `payment-order recovery cannot resolve exact order dependencies for ${chunk.from} to ${chunk.to}`,
            ),
            log,
          );
        }
        const retried = await retryNormalizeReconcile(
          deps,
          window,
          chunk,
          chunks,
          completed,
          log,
        );
        if (!retried.ok) {
          return retried.result;
        }
        verdict = retried.verdict;
        continue;
      }

      log(`Final chunk result: FAIL`);
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
        message: `reconciliation FAIL for ${chunk.from} to ${chunk.to}`,
      };
    }

    log("Final chunk result: PASS");
    log("");
    completed += 1;
  }

  return { ok: true, dryRun: false, chunks, completed };
}

async function retryNormalizeReconcile(
  deps: SquareCommerceBackfillDeps,
  window: SquareFarmWindow,
  chunk: SquareCommerceBackfillChunk,
  chunks: SquareCommerceBackfillChunk[],
  completed: number,
  log: (line: string) => void,
): Promise<
  | { ok: true; verdict: SquareCommerceReconcileVerdict }
  | { ok: false; result: SquareCommerceBackfillResult }
> {
  try {
    const normalized = await deps.normalizeWindow(window);
    log("Retry normalize");
    logNormalize(normalized, log);
  } catch (error) {
    return {
      ok: false,
      result: fail(chunks, completed, chunk, "normalize", error, log),
    };
  }
  try {
    const verdict = await deps.reconcileWindow(window);
    log("Retry reconcile");
    logReconcile(verdict, log);
    return { ok: true, verdict };
  } catch (error) {
    return {
      ok: false,
      result: fail(chunks, completed, chunk, "reconcile", error, log),
    };
  }
}

function logImport(
  imported: SquareCommerceImportSummary,
  log: (line: string) => void,
): void {
  log(`Orders fetched: ${imported.ordersFetched}`);
  log(`Payments fetched: ${imported.paymentsFetched}`);
  log(`Refunds fetched: ${imported.refundsFetched}`);
  log(`Snapshots inserted: ${imported.snapshotsInserted}`);
  log(`Snapshots unchanged: ${imported.snapshotsUnchanged}`);
  log("");
}

function logNormalize(
  normalized: SquareCommerceNormalizeSummary,
  log: (line: string) => void,
): void {
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
}

function logReconcile(
  verdict: SquareCommerceReconcileVerdict,
  log: (line: string) => void,
): void {
  log(`Result: ${verdict.passed ? "PASS" : "FAIL"}`);
  if (!verdict.passed) {
    for (const difference of verdict.differences) {
      log(`- ${difference}`);
    }
  }
  log("");
}

function logCatalogRecovery(
  discovery: CatalogRecoveryDiscovery,
  persist: SquareCatalogRecoveryResult["persist"],
  log: (line: string) => void,
): void {
  log(`Unresolved lines: ${discovery.unresolvedSaleLines}`);
  log(`Exact object/version pairs: ${discovery.pairs.length}`);
  if (persist) {
    log(`Requested: ${persist.historicalObjectsRequested}`);
    log(`Returned: ${persist.historicalVariationsReturned}`);
    log(`Missing: ${persist.missingObjects}`);
    log(`Unexpected types: ${persist.unexpectedObjectTypes}`);
    log(`Snapshots inserted: ${persist.snapshotsInserted}`);
    log(`Snapshots unchanged: ${persist.snapshotsUnchanged}`);
  }
  log("");
}

function logPaymentOrderRecovery(
  discovery: PaymentOrderRecoveryDiscovery,
  persist: SquarePaymentOrderRecoveryResult["persist"],
  log: (line: string) => void,
): void {
  log(`Unresolved payments: ${discovery.unresolvedPayments}`);
  log(
    `Distinct exact missing orders: ${discovery.distinctMissingOrderIds.length}`,
  );
  if (persist) {
    log(`Orders requested: ${persist.ordersRequested}`);
    log(`Orders returned: ${persist.ordersReturned}`);
    log(`Orders missing: ${persist.ordersMissing}`);
    log(
      `Closed before requested payment window: ${persist.closedAt.closedBeforeWindow}`,
    );
    log(
      `Closed inside requested payment window: ${persist.closedAt.closedInsideWindow}`,
    );
    log(
      `Closed after requested payment window: ${persist.closedAt.closedAfterWindow}`,
    );
    log(`Missing closed_at: ${persist.closedAt.missingClosedAt}`);
    log(`Snapshots inserted: ${persist.snapshotsInserted}`);
    log(`Snapshots unchanged: ${persist.snapshotsUnchanged}`);
  }
  log("");
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
