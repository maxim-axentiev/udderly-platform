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
    canonicalPayments: 1,
    sourcePaymentAmount: 1000,
    canonicalPaymentAmount: 1000,
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

test("unresolved variation is FAIL", () => {
  const verdict = evaluateSquareCommerceReconciliation(
    totals({ unresolvedVariations: 1 }),
  );
  assert.equal(verdict.passed, false);
  assert.match(formatSquareCommerceReconcile(verdict), /Result: FAIL/);
  assert.match(verdict.differences.join("\n"), /Unresolved variations: 1/);
});
