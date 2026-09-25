import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyReconcileTotals,
  evaluateSquareCommerceReconciliation,
  formatSquareCommerceReconcile,
  type SquareCommerceReconcileTotals,
} from "./square.commerce.reconcile";

function totals(
  overrides: Partial<SquareCommerceReconcileTotals>,
): SquareCommerceReconcileTotals {
  return {
    ...emptyReconcileTotals("2026-09-15 to 2026-09-15 (America/Toronto)"),
    sourceOrders: 2,
    grossSaleOrders: 1,
    returnOnlyOrders: 1,
    canonicalSales: 1,
    sourceLineItems: 1,
    canonicalLineItems: 1,
    activeCanonicalLines: 1,
    sourcePayments: 1,
    canonicalizableSourcePayments: 1,
    failedNonSettledAttempts: 0,
    canonicalPayments: 1,
    sourcePaymentAmount: 1000,
    canonicalPaymentAmount: 1000,
    failedAttemptRequestedAmount: 0,
    sourceGrossSaleTotal: 1000,
    canonicalSaleTotal: 1000,
    sourceRefunds: 1,
    canonicalRefunds: 1,
    sourceRefundAmount: 200,
    canonicalRefundAmount: 200,
    ...overrides,
  };
}

test("clean reconciliation including return-only is PASS", () => {
  const verdict = evaluateSquareCommerceReconciliation(totals({}));
  assert.equal(verdict.passed, true);
  const report = formatSquareCommerceReconcile(verdict);
  assert.match(report, /Result: PASS/);
  assert.match(report, /Return-only orders: 1/);
  assert.equal(report.includes("SYN-"), false);
  assert.equal(report.includes("@"), false);
});

test("E. reconciliation with a custom/non-catalog line is PASS", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({
      sourceLineItems: 2,
      canonicalLineItems: 2,
      activeCanonicalLines: 2,
      customNonCatalogLines: 1,
    }),
  );
  assert.equal(verdict.passed, true);
  assert.match(
    formatSquareCommerceReconcile(verdict),
    /Custom\/non-catalog lines: 1/,
  );
});

test("return-adjustment non-sale does not cause FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({
      sourceOrders: 3,
      returnAdjustmentNonSales: 1,
    }),
  );
  assert.equal(verdict.passed, true);
  assert.match(
    formatSquareCommerceReconcile(verdict),
    /Return-adjustment non-sales: 1/,
  );
});

test("K. October-style positive return rollup is return-only and does not change sales", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({
      sourceOrders: 3,
      returnOnlyOrders: 2,
    }),
  );
  assert.equal(verdict.passed, true);
  assert.equal(verdict.totals.canonicalSales, 1);
  assert.equal(verdict.totals.sourceGrossSaleTotal, 1000);
  assert.equal(verdict.totals.canonicalSaleTotal, 1000);
  assert.match(formatSquareCommerceReconcile(verdict), /Return-only orders: 2/);
  assert.match(formatSquareCommerceReconcile(verdict), /Invalid orders: 0/);
});

test("sale count mismatch is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ canonicalSales: 0 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Sale counts/);
});

test("sale money mismatch is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ canonicalSaleTotal: 900 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Sale total/);
});

test("line mismatch is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ activeCanonicalLines: 0 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Line counts/);
});

test("inactive lines matching newer source state do not fail", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({
      sourceLineItems: 1,
      activeCanonicalLines: 1,
      inactiveCanonicalLines: 1,
      canonicalLineItems: 2,
    }),
  );
  assert.equal(verdict.passed, true);
});

test("payment mismatch is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ canonicalPayments: 0 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Payment counts/);
});

test("G. valid skipped failed non-settled attempt is PASS", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({
      sourcePayments: 2,
      canonicalizableSourcePayments: 1,
      failedNonSettledAttempts: 1,
      canonicalPayments: 1,
      sourcePaymentAmount: 1000,
      canonicalPaymentAmount: 1000,
      failedAttemptRequestedAmount: 19972,
    }),
  );
  assert.equal(verdict.passed, true);
  const report = formatSquareCommerceReconcile(verdict);
  assert.match(report, /Source payment records: 2/);
  assert.match(report, /Canonicalizable source payments: 1/);
  assert.match(report, /Failed non-settled attempts: 1/);
  assert.match(report, /Failed attempt requested amount: 19972/);
  assert.match(report, /Source canonical payment amount: 1000/);
});

test("K. unresolved non-failed payment remains FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({
      sourcePayments: 2,
      canonicalizableSourcePayments: 2,
      failedNonSettledAttempts: 0,
      canonicalPayments: 1,
    }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Payment counts/);
});

test("refund mismatch is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ canonicalRefundAmount: 0 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Refund amount/);
});

test("invalid order is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ invalidOrders: 1, sourceOrders: 3 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(verdict.differences.join("\n"), /Invalid orders: 1/);
});

test("F. unresolved catalog-bearing line is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ unresolvedVariations: 1 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(formatSquareCommerceReconcile(verdict), /Result: FAIL/);
  assert.match(verdict.differences.join("\n"), /Unresolved variations: 1/);
});
