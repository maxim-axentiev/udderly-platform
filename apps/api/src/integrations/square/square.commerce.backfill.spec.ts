import assert from "node:assert/strict";
import test from "node:test";
import type { SquareCatalogRecoveryResult } from "./square-catalog-recovery.service";
import type { SquareCommerceImportSummary } from "./square-commerce-import.service";
import type { SquareCommerceNormalizeSummary } from "./square-commerce-normalize.service";
import type { SquarePaymentOrderRecoveryResult } from "./square-payment-order-recovery.service";
import type { CatalogRecoveryDiscovery } from "./square.catalog.recovery";
import type { PaymentOrderRecoveryDiscovery } from "./square.commerce.payment-order-recovery";
import {
  formatSquareCommerceBackfillDryRun,
  parseSquareCommerceBackfillArgs,
  runSquareCommerceBackfill,
  squareCommerceMonthChunks,
  type SquareCommerceBackfillDeps,
} from "./square.commerce.backfill";
import {
  emptyReconcileTotals,
  evaluateSquareCommerceReconciliation,
  type SquareCommerceReconcileTotals,
  type SquareCommerceReconcileVerdict,
} from "./square.commerce.reconcile";
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

function cleanTotals(
  overrides: Partial<SquareCommerceReconcileTotals> = {},
): SquareCommerceReconcileTotals {
  return {
    ...emptyReconcileTotals("2026-01-01 to 2026-01-31 (America/Toronto)"),
    sourceOrders: 1,
    grossSaleOrders: 1,
    canonicalSales: 1,
    sourceLineItems: 1,
    canonicalLineItems: 1,
    activeCanonicalLines: 1,
    sourcePayments: 1,
    canonicalizableSourcePayments: 1,
    canonicalPayments: 1,
    sourcePaymentAmount: 1000,
    canonicalPaymentAmount: 1000,
    ...overrides,
  };
}

function verdictFrom(
  overrides: Partial<SquareCommerceReconcileTotals> = {},
): SquareCommerceReconcileVerdict {
  return evaluateSquareCommerceReconciliation(cleanTotals(overrides));
}

function catalogDiscovery(pairs: number): CatalogRecoveryDiscovery {
  return {
    unresolvedSaleLines: pairs,
    pairs: Array.from({ length: pairs }, (_, index) => ({
      catalogObjectId: `VAR-${index}`,
      catalogVersion: 1,
    })),
    distinctObjects: pairs,
    distinctVersions: pairs > 0 ? 1 : 0,
  };
}

function catalogResult(
  pairs: number,
  persist: Partial<NonNullable<SquareCatalogRecoveryResult["persist"]>>,
): SquareCatalogRecoveryResult {
  const discovery = catalogDiscovery(pairs);
  return {
    dryRun: false,
    discovery,
    persist: {
      historicalObjectsRequested: pairs,
      historicalVariationsReturned: pairs,
      relatedItemsReturned: pairs,
      missingObjects: 0,
      unexpectedObjectTypes: 0,
      snapshotsInserted: pairs,
      snapshotsUnchanged: 0,
      ...persist,
    },
    report: "safe",
  };
}

function paymentDiscovery(missingOrders: number): PaymentOrderRecoveryDiscovery {
  return {
    unresolvedPayments: missingOrders,
    distinctMissingOrderIds: Array.from(
      { length: missingOrders },
      (_, index) => `ORDER-${index}`,
    ),
    paymentAmountAwaitingDependency: missingOrders * 100,
  };
}

function paymentResult(
  missingOrders: number,
  persist: Partial<
    NonNullable<SquarePaymentOrderRecoveryResult["persist"]>
  > = {},
): SquarePaymentOrderRecoveryResult {
  const discovery = paymentDiscovery(missingOrders);
  const returned = persist.ordersReturned ?? missingOrders;
  const missing = persist.ordersMissing ?? 0;
  return {
    dryRun: false,
    discovery,
    persist: {
      ordersRequested: missingOrders,
      ordersReturned: returned,
      ordersMissing: missing,
      snapshotsInserted: returned,
      snapshotsUnchanged: 0,
      closedAt: {
        closedBeforeWindow: returned,
        closedInsideWindow: 0,
        closedAfterWindow: 0,
        missingClosedAt: 0,
        ...persist.closedAt,
      },
      ...persist,
    },
    report: "safe",
  };
}

type HealingOptions = {
  reconQueue: SquareCommerceReconcileVerdict[];
  catalogPairs?: number;
  catalogPersist?: Partial<NonNullable<SquareCatalogRecoveryResult["persist"]>>;
  paymentMissing?: number;
  paymentPersist?: Partial<
    NonNullable<SquarePaymentOrderRecoveryResult["persist"]>
  >;
};

function healingDeps(options: HealingOptions): {
  deps: SquareCommerceBackfillDeps;
  imports: string[];
  normalizes: string[];
  reconciles: string[];
  catalogDiscovers: number;
  catalogRecovers: number;
  catalogNormalizes: number;
  paymentDiscovers: number;
  paymentRecovers: number;
} {
  const imports: string[] = [];
  const normalizes: string[] = [];
  const reconciles: string[] = [];
  const counters = {
    catalogDiscovers: 0,
    catalogRecovers: 0,
    catalogNormalizes: 0,
    paymentDiscovers: 0,
    paymentRecovers: 0,
  };
  const reconQueue = [...options.reconQueue];
  return {
    imports,
    normalizes,
    reconciles,
    get catalogDiscovers() {
      return counters.catalogDiscovers;
    },
    get catalogRecovers() {
      return counters.catalogRecovers;
    },
    get catalogNormalizes() {
      return counters.catalogNormalizes;
    },
    get paymentDiscovers() {
      return counters.paymentDiscovers;
    },
    get paymentRecovers() {
      return counters.paymentRecovers;
    },
    deps: {
      async importWindow(window) {
        imports.push(windowKey(window));
        return importSummary();
      },
      async normalizeWindow(window) {
        normalizes.push(windowKey(window));
        return normalizeSummary();
      },
      async reconcileWindow(window) {
        reconciles.push(windowKey(window));
        const next = reconQueue.shift();
        if (!next) {
          throw new Error("unexpected extra reconcile");
        }
        return next;
      },
      async discoverCatalogWindow() {
        counters.catalogDiscovers += 1;
        return catalogDiscovery(options.catalogPairs ?? 0);
      },
      async recoverCatalogWindow() {
        counters.catalogRecovers += 1;
        return catalogResult(
          options.catalogPairs ?? 0,
          options.catalogPersist ?? {},
        );
      },
      async normalizeCatalogLatest() {
        counters.catalogNormalizes += 1;
        return {
          categories: 0,
          products: 1,
          variations: 1,
          categoryAssignments: 0,
          archivedProducts: 0,
          unresolvedParents: 0,
          unresolvedCategories: 0,
          skippedStale: 0,
        };
      },
      async discoverPaymentOrderWindow() {
        counters.paymentDiscovers += 1;
        return paymentDiscovery(options.paymentMissing ?? 0);
      },
      async recoverPaymentOrderWindow() {
        counters.paymentRecovers += 1;
        return paymentResult(
          options.paymentMissing ?? 0,
          options.paymentPersist ?? {},
        );
      },
    },
  };
}

const MONTH = { from: "2026-01-01", to: "2026-01-31", dryRun: false };

test("recovery A. clean month PASS, no recovery called", async () => {
  const recorded = healingDeps({ reconQueue: [verdictFrom()] });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, true);
  assert.equal(recorded.catalogRecovers, 0);
  assert.equal(recorded.paymentRecovers, 0);
  assert.deepEqual(recorded.reconciles, ["2026-01-01/2026-01-31"]);
});

test("recovery B. unresolved catalog -> exact recovery -> retry -> PASS", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ unresolvedVariations: 1 }), verdictFrom()],
    catalogPairs: 1,
  });
  const lines: string[] = [];
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    (line) => lines.push(line),
  );
  assert.equal(result.ok, true);
  assert.equal(recorded.catalogRecovers, 1);
  assert.equal(recorded.catalogNormalizes, 1);
  assert.equal(recorded.paymentRecovers, 0);
  assert.equal(recorded.normalizes.length, 2);
  assert.equal(recorded.reconciles.length, 2);
  assert.equal(lines.includes("Automatic catalog recovery"), true);
  assert.equal(lines.includes("Final chunk result: PASS"), true);
  assert.equal(lines.some((line) => line.includes("VAR-")), false);
});

test("recovery C. catalog recovery missing object -> FAIL and stop", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ unresolvedVariations: 1 })],
    catalogPairs: 1,
    catalogPersist: {
      historicalVariationsReturned: 0,
      missingObjects: 1,
      snapshotsInserted: 0,
    },
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2025-12-01", to: "2026-01-31", dryRun: false },
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "catalog-recovery");
  assert.deepEqual(result.failedChunk, { from: "2026-01-01", to: "2026-01-31" });
  assert.equal(result.completed, 0);
  assert.equal(recorded.catalogRecovers, 1);
  assert.equal(recorded.catalogNormalizes, 0);
  assert.equal(recorded.imports.length, 1);
});

test("recovery D. catalog recovery leaves unresolved variation -> FAIL", async () => {
  const recorded = healingDeps({
    reconQueue: [
      verdictFrom({ unresolvedVariations: 1 }),
      verdictFrom({ unresolvedVariations: 1 }),
    ],
    catalogPairs: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "reconcile");
  assert.equal(recorded.catalogRecovers, 1);
  assert.equal(recorded.reconciles.length, 2);
});

test("recovery E. unresolved payment + missing exact order -> recovery -> retry -> PASS", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ canonicalPayments: 0 }), verdictFrom()],
    paymentMissing: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, true);
  assert.equal(recorded.paymentRecovers, 1);
  assert.equal(recorded.catalogRecovers, 0);
  assert.equal(recorded.normalizes.length, 2);
});

test("recovery F. recovered OPEN order + failed non-settled skip -> PASS", async () => {
  const recorded = healingDeps({
    reconQueue: [
      verdictFrom({ canonicalPayments: 0 }),
      verdictFrom({
        sourcePayments: 1,
        canonicalizableSourcePayments: 0,
        failedNonSettledAttempts: 1,
        canonicalPayments: 0,
        sourcePaymentAmount: 0,
        canonicalPaymentAmount: 0,
        failedAttemptRequestedAmount: 19972,
      }),
    ],
    paymentMissing: 1,
    paymentPersist: {
      closedAt: {
        closedBeforeWindow: 0,
        closedInsideWindow: 0,
        closedAfterWindow: 0,
        missingClosedAt: 1,
      },
    },
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, true);
  assert.equal(recorded.paymentRecovers, 1);
});

test("recovery G. recovered terminal order -> exact dependency sale/payment -> PASS", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ canonicalPayments: 0 }), verdictFrom()],
    paymentMissing: 1,
    paymentPersist: {
      closedAt: {
        closedBeforeWindow: 1,
        closedInsideWindow: 0,
        closedAfterWindow: 0,
        missingClosedAt: 0,
      },
    },
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, true);
  assert.equal(recorded.paymentRecovers, 1);
});

test("recovery H. payment recovery missing order -> FAIL", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ canonicalPayments: 0 })],
    paymentMissing: 1,
    paymentPersist: {
      ordersReturned: 0,
      ordersMissing: 1,
      snapshotsInserted: 0,
    },
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "payment-order-recovery");
  assert.equal(recorded.paymentRecovers, 1);
  assert.equal(recorded.normalizes.length, 1);
});

test("recovery I. ambiguous unresolved payment -> FAIL", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ canonicalPayments: 0 })],
    paymentMissing: 0,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "reconcile");
  assert.equal(recorded.paymentDiscovers, 1);
  assert.equal(recorded.paymentRecovers, 0);
});

test("recovery J. catalog and payment recovery each run max once -> PASS", async () => {
  const recorded = healingDeps({
    reconQueue: [
      verdictFrom({ unresolvedVariations: 1, canonicalPayments: 0 }),
      verdictFrom({ canonicalPayments: 0 }),
      verdictFrom(),
    ],
    catalogPairs: 1,
    paymentMissing: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, true);
  assert.equal(recorded.catalogRecovers, 1);
  assert.equal(recorded.paymentRecovers, 1);
  assert.equal(recorded.catalogNormalizes, 1);
  assert.equal(recorded.reconciles.length, 3);
});

test("recovery K. recovery succeeds but money still mismatches -> FAIL", async () => {
  const recorded = healingDeps({
    reconQueue: [
      verdictFrom({ unresolvedVariations: 1 }),
      verdictFrom({ canonicalPaymentAmount: 900 }),
    ],
    catalogPairs: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.failedStep, "reconcile");
  assert.equal(recorded.catalogRecovers, 1);
  assert.equal(recorded.paymentRecovers, 0);
});

test("recovery L. retry count is bounded", async () => {
  const recorded = healingDeps({
    reconQueue: [
      verdictFrom({ unresolvedVariations: 1 }),
      verdictFrom({ unresolvedVariations: 1 }),
    ],
    catalogPairs: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(result.ok, false);
  assert.equal(recorded.catalogRecovers, 1);
  assert.equal(recorded.catalogDiscovers, 1);
});

test("recovery M. rerun is idempotent", async () => {
  const first = healingDeps({
    reconQueue: [verdictFrom({ unresolvedVariations: 1 }), verdictFrom()],
    catalogPairs: 1,
  });
  const second = healingDeps({ reconQueue: [verdictFrom()] });
  const runOne = await runSquareCommerceBackfill(
    first.deps,
    MONTH,
    () => undefined,
  );
  const runTwo = await runSquareCommerceBackfill(
    second.deps,
    MONTH,
    () => undefined,
  );
  assert.equal(runOne.ok, true);
  assert.equal(runTwo.ok, true);
  assert.equal(first.catalogRecovers, 1);
  assert.equal(second.catalogRecovers, 0);
});

test("recovery N. dry-run performs no API calls or writes", async () => {
  const recorded = healingDeps({
    reconQueue: [verdictFrom({ unresolvedVariations: 1 })],
    catalogPairs: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2023-09-05", to: "2026-01-31", dryRun: true },
    () => undefined,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.dryRun, true);
  assert.deepEqual(recorded.imports, []);
  assert.equal(recorded.catalogRecovers, 0);
  assert.equal(recorded.paymentRecovers, 0);
  assert.equal(recorded.catalogNormalizes, 0);
});

test("recovery O. later months continue only after PASS", async () => {
  const recorded = healingDeps({
    reconQueue: [
      verdictFrom({ unresolvedVariations: 1 }),
      verdictFrom(),
      verdictFrom(),
    ],
    catalogPairs: 1,
  });
  const result = await runSquareCommerceBackfill(
    recorded.deps,
    { from: "2025-12-01", to: "2026-01-31", dryRun: false },
    () => undefined,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.completed, 2);
  assert.deepEqual(recorded.imports, [
    "2026-01-01/2026-01-31",
    "2025-12-01/2025-12-31",
  ]);
  assert.equal(recorded.catalogRecovers, 1);
});

