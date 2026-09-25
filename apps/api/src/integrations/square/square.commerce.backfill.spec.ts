import assert from "node:assert/strict";
import test from "node:test";
import type { SquareCommerceImportSummary } from "./square-commerce-import.service";
import type { SquareCommerceNormalizeSummary } from "./square-commerce-normalize.service";
import {
  formatSquareCommerceBackfillDryRun,
  parseSquareCommerceBackfillArgs,
  runSquareCommerceBackfill,
  squareCommerceMonthChunks,
  type SquareCommerceBackfillDeps,
} from "./square.commerce.backfill";
import { emptyReconcileTotals } from "./square.commerce.reconcile";
import type { SquareFarmWindow } from "./square.range";

function windowKey(window: SquareFarmWindow): string {
  if ("date" in window) {
    return window.date;
  }
  return `${window.from}/${window.to}`;
}

function importSummary(): SquareCommerceImportSummary {
  return {
    ordersFetched: 2,
    paymentsFetched: 2,
    refundsFetched: 1,
    snapshotsInserted: 3,
    snapshotsUnchanged: 1,
    snapshotsSkipped: 0,
  };
}

function normalizeSummary(): SquareCommerceNormalizeSummary {
  return {
    sales: 2,
    lineItems: 4,
    payments: 2,
    refunds: 1,
    customNonCatalogLines: 1,
    unresolvedCatalogLines: 0,
    unresolvedPayments: 0,
    unresolvedRefunds: 0,
    skippedStale: 0,
    invalidProcessingFees: 0,
    returnOnlyOrdersSkipped: 0,
    returnAdjustmentNonSalesSkipped: 0,
    invalidOrderMoneySkipped: 0,
    dependencyOrdersApplied: 0,
    failedNonSettledPaymentAttemptsSkipped: 0,
  };
}

function recordingDeps(options?: {
  importError?: Error;
  normalizeError?: Error;
  reconcileError?: Error;
  failReconcileOn?: string;
}): {
  deps: SquareCommerceBackfillDeps;
  imports: string[];
  normalizes: string[];
  reconciles: string[];
} {
  const imports: string[] = [];
  const normalizes: string[] = [];
  const reconciles: string[] = [];
  return {
    imports,
    normalizes,
    reconciles,
    deps: {
      async importWindow(window) {
        imports.push(windowKey(window));
        if (options?.importError) {
          throw options.importError;
        }
        return importSummary();
      },
      async normalizeWindow(window) {
        normalizes.push(windowKey(window));
        if (options?.normalizeError) {
          throw options.normalizeError;
        }
        return normalizeSummary();
      },
      async reconcileWindow(window) {
        reconciles.push(windowKey(window));
        if (options?.reconcileError) {
          throw options.reconcileError;
        }
        const key = windowKey(window);
        const passed = options?.failReconcileOn !== key;
        return {
          passed,
          differences: passed ? [] : ["Invalid orders: 1"],
          totals: emptyReconcileTotals(),
        };
      },
    },
  };
}

test("A. dry-run month chunk generation", () => {
  const plan = parseSquareCommerceBackfillArgs([
    "--from",
    "2023-09-05",
    "--to",
    "2026-08-16",
    "--dry-run",
  ]);
  assert.deepEqual(plan, {
    from: "2023-09-05",
    to: "2026-08-16",
    dryRun: true,
  });
  const report = formatSquareCommerceBackfillDryRun(plan!);
  assert.match(report, /Requested range:\n2023-09-05 to 2026-08-16/);
  assert.match(report, /2026-08-01 to 2026-08-16/);
  assert.match(report, /2026-07-01 to 2026-07-31/);
  assert.match(report, /2023-09-05 to 2023-09-30/);
  assert.match(report, /Dry run only\. No data changed\./);
});

test("B. partial first month and C. partial last month", () => {
  const chunks = squareCommerceMonthChunks("2026-05-12", "2026-07-08");
  assert.deepEqual(chunks.at(-1), { from: "2026-05-12", to: "2026-05-31" });
  assert.deepEqual(chunks[0], { from: "2026-07-01", to: "2026-07-08" });
});

test("D. newest-to-oldest ordering", () => {
  const chunks = squareCommerceMonthChunks("2026-05-01", "2026-07-31");
  assert.deepEqual(chunks, [
    { from: "2026-07-01", to: "2026-07-31" },
    { from: "2026-06-01", to: "2026-06-30" },
    { from: "2026-05-01", to: "2026-05-31" },
  ]);
});

test("E. one-month range", () => {
  assert.deepEqual(squareCommerceMonthChunks("2026-07-01", "2026-07-31"), [
    { from: "2026-07-01", to: "2026-07-31" },
  ]);
  assert.deepEqual(squareCommerceMonthChunks("2026-07-10", "2026-07-20"), [
    { from: "2026-07-10", to: "2026-07-20" },
  ]);
});

test("F. import failure stops", async () => {
  const recorded = recordingDeps({
    importError: new Error("square_unavailable"),
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2026-06-01", to: "2026-07-31", dryRun: false },
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "import");
  assert.deepEqual(result.failedChunk, { from: "2026-07-01", to: "2026-07-31" });
  assert.equal(result.completed, 0);
  assert.deepEqual(recorded.imports, ["2026-07-01/2026-07-31"]);
  assert.deepEqual(recorded.normalizes, []);
  assert.deepEqual(recorded.reconciles, []);
});

test("G. normalize failure stops", async () => {
  const recorded = recordingDeps({
    normalizeError: new Error("normalize_failed"),
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2026-06-01", to: "2026-07-31", dryRun: false },
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "normalize");
  assert.deepEqual(result.failedChunk, { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(recorded.imports, ["2026-07-01/2026-07-31"]);
  assert.deepEqual(recorded.normalizes, ["2026-07-01/2026-07-31"]);
  assert.deepEqual(recorded.reconciles, []);
});

test("H. reconciliation FAIL stops", async () => {
  const recorded = recordingDeps({
    failReconcileOn: "2026-07-01/2026-07-31",
  });
  const lines: string[] = [];
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2026-06-01", to: "2026-07-31", dryRun: false },
    (line) => lines.push(line),
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "reconcile");
  assert.deepEqual(result.failedChunk, { from: "2026-07-01", to: "2026-07-31" });
  assert.equal(result.completed, 0);
  assert.deepEqual(recorded.imports, ["2026-07-01/2026-07-31"]);
  assert.deepEqual(recorded.reconciles, ["2026-07-01/2026-07-31"]);
  assert.equal(lines.includes("Failed chunk: 2026-07-01 to 2026-07-31"), true);
  assert.equal(lines.includes("Result: FAIL"), true);
});

test("I. PASS continues to next chunk", async () => {
  const recorded = recordingDeps();
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2026-06-01", to: "2026-07-31", dryRun: false },
    () => undefined,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.completed, 2);
  assert.deepEqual(recorded.imports, [
    "2026-07-01/2026-07-31",
    "2026-06-01/2026-06-30",
  ]);
  assert.deepEqual(recorded.normalizes, recorded.imports);
  assert.deepEqual(recorded.reconciles, recorded.imports);
});

test("J. completed chunks may be safely rerun", async () => {
  const recorded = recordingDeps();
  const plan = { from: "2026-07-01", to: "2026-07-31", dryRun: false };
  const first = await runSquareCommerceBackfill(
    recorded.deps,
    plan,
    () => undefined,
  );
  const second = await runSquareCommerceBackfill(
    recorded.deps,
    plan,
    () => undefined,
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(recorded.imports, [
    "2026-07-01/2026-07-31",
    "2026-07-01/2026-07-31",
  ]);
});

test("K. dry-run performs no import/normalize/reconcile calls", async () => {
  const recorded = recordingDeps();
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2023-09-05", to: "2026-08-16", dryRun: true },
    () => undefined,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.dryRun, true);
  assert.equal(result.completed, 0);
  assert.equal(result.chunks[0]?.from, "2026-08-01");
  assert.deepEqual(recorded.imports, []);
  assert.deepEqual(recorded.normalizes, []);
  assert.deepEqual(recorded.reconciles, []);
});
