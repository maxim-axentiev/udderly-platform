import { FARM_TIME_ZONE } from "./square.range";

export type SquareCommerceReconcileTotals = {
  rangeLabel: string;
  sourceOrders: number;
  grossSaleOrders: number;
  returnOnlyOrders: number;
  invalidOrders: number;
  canonicalSales: number;
  sourceLineItems: number;
  canonicalLineItems: number;
  activeCanonicalLines: number;
  inactiveCanonicalLines: number;
  unresolvedVariations: number;
  sourceGrossSaleTotal: number;
  canonicalSaleTotal: number;
  sourceTax: number;
  canonicalTax: number;
  sourceDiscount: number;
  canonicalDiscount: number;
  sourceServiceCharge: number;
  canonicalServiceCharge: number;
  sourcePayments: number;
  canonicalPayments: number;
  sourcePaymentAmount: number;
  canonicalPaymentAmount: number;
  sourceTips: number;
  canonicalTips: number;
  sourceProcessingFees: number;
  canonicalProcessingFees: number;
  sourceRefunds: number;
  canonicalRefunds: number;
  sourceRefundAmount: number;
  canonicalRefundAmount: number;
};

export type SquareCommerceReconcileVerdict = {
  passed: boolean;
  differences: string[];
  totals: SquareCommerceReconcileTotals;
};

export function evaluateSquareCommerceReconciliation(
  totals: SquareCommerceReconcileTotals,
): SquareCommerceReconcileVerdict {
  const differences: string[] = [];
  if (totals.invalidOrders !== 0) {
    differences.push(`Invalid orders: ${totals.invalidOrders}`);
  }
  if (totals.unresolvedVariations !== 0) {
    differences.push(`Unresolved variations: ${totals.unresolvedVariations}`);
  }
  if (totals.grossSaleOrders !== totals.canonicalSales) {
    differences.push(
      `Sale counts: gross ${totals.grossSaleOrders}, canonical ${totals.canonicalSales}`,
    );
  }
  if (totals.sourceLineItems !== totals.activeCanonicalLines) {
    differences.push(
      `Line counts: source ${totals.sourceLineItems}, active canonical ${totals.activeCanonicalLines}`,
    );
  }
  if (totals.sourcePayments !== totals.canonicalPayments) {
    differences.push(
      `Payment counts: source ${totals.sourcePayments}, canonical ${totals.canonicalPayments}`,
    );
  }
  if (totals.sourceRefunds !== totals.canonicalRefunds) {
    differences.push(
      `Refund counts: source ${totals.sourceRefunds}, canonical ${totals.canonicalRefunds}`,
    );
  }
  pushMoneyDiff(
    differences,
    "Sale total",
    totals.sourceGrossSaleTotal,
    totals.canonicalSaleTotal,
  );
  pushMoneyDiff(differences, "Tax", totals.sourceTax, totals.canonicalTax);
  pushMoneyDiff(
    differences,
    "Discount",
    totals.sourceDiscount,
    totals.canonicalDiscount,
  );
  pushMoneyDiff(
    differences,
    "Service charge",
    totals.sourceServiceCharge,
    totals.canonicalServiceCharge,
  );
  pushMoneyDiff(
    differences,
    "Payment amount",
    totals.sourcePaymentAmount,
    totals.canonicalPaymentAmount,
  );
  pushMoneyDiff(differences, "Tips", totals.sourceTips, totals.canonicalTips);
  pushMoneyDiff(
    differences,
    "Processing fees",
    totals.sourceProcessingFees,
    totals.canonicalProcessingFees,
  );
  pushMoneyDiff(
    differences,
    "Refund amount",
    totals.sourceRefundAmount,
    totals.canonicalRefundAmount,
  );
  return {
    passed: differences.length === 0,
    differences,
    totals,
  };
}

export function formatSquareCommerceReconcile(
  verdict: SquareCommerceReconcileVerdict,
): string {
  const t = verdict.totals;
  const lines = [
    "Square commerce reconciliation",
    "",
    `Range: ${t.rangeLabel}`,
    "",
    "Orders",
    `Source orders: ${t.sourceOrders}`,
    `Gross sale orders: ${t.grossSaleOrders}`,
    `Return-only orders: ${t.returnOnlyOrders}`,
    `Invalid orders: ${t.invalidOrders}`,
    `Canonical sales: ${t.canonicalSales}`,
    "",
    "Line items",
    `Source line items: ${t.sourceLineItems}`,
    `Canonical line items: ${t.canonicalLineItems}`,
    `Active canonical lines: ${t.activeCanonicalLines}`,
    `Inactive canonical lines: ${t.inactiveCanonicalLines}`,
    `Unresolved variations: ${t.unresolvedVariations}`,
    "",
    "Sales money",
    `Source gross sale total: ${t.sourceGrossSaleTotal}`,
    `Canonical sale total: ${t.canonicalSaleTotal}`,
    `Source tax: ${t.sourceTax}`,
    `Canonical tax: ${t.canonicalTax}`,
    `Source discount: ${t.sourceDiscount}`,
    `Canonical discount: ${t.canonicalDiscount}`,
    `Source service charge: ${t.sourceServiceCharge}`,
    `Canonical service charge: ${t.canonicalServiceCharge}`,
    "",
    "Payments",
    `Source payments: ${t.sourcePayments}`,
    `Canonical payments: ${t.canonicalPayments}`,
    `Source payment amount: ${t.sourcePaymentAmount}`,
    `Canonical payment amount: ${t.canonicalPaymentAmount}`,
    `Source tips: ${t.sourceTips}`,
    `Canonical tips: ${t.canonicalTips}`,
    `Source processing fees: ${t.sourceProcessingFees}`,
    `Canonical processing fees: ${t.canonicalProcessingFees}`,
    "",
    "Refunds",
    `Source refunds: ${t.sourceRefunds}`,
    `Canonical refunds: ${t.canonicalRefunds}`,
    `Source refund amount: ${t.sourceRefundAmount}`,
    `Canonical refund amount: ${t.canonicalRefundAmount}`,
    "",
    `Result: ${verdict.passed ? "PASS" : "FAIL"}`,
  ];
  if (!verdict.passed) {
    lines.push("");
    lines.push("Differences");
    for (const difference of verdict.differences) {
      lines.push(`- ${difference}`);
    }
  }
  return lines.join("\n");
}

export function emptyReconcileTotals(
  rangeLabel = `1970-01-01 to 1970-01-01 (${FARM_TIME_ZONE})`,
): SquareCommerceReconcileTotals {
  return {
    rangeLabel,
    sourceOrders: 0,
    grossSaleOrders: 0,
    returnOnlyOrders: 0,
    invalidOrders: 0,
    canonicalSales: 0,
    sourceLineItems: 0,
    canonicalLineItems: 0,
    activeCanonicalLines: 0,
    inactiveCanonicalLines: 0,
    unresolvedVariations: 0,
    sourceGrossSaleTotal: 0,
    canonicalSaleTotal: 0,
    sourceTax: 0,
    canonicalTax: 0,
    sourceDiscount: 0,
    canonicalDiscount: 0,
    sourceServiceCharge: 0,
    canonicalServiceCharge: 0,
    sourcePayments: 0,
    canonicalPayments: 0,
    sourcePaymentAmount: 0,
    canonicalPaymentAmount: 0,
    sourceTips: 0,
    canonicalTips: 0,
    sourceProcessingFees: 0,
    canonicalProcessingFees: 0,
    sourceRefunds: 0,
    canonicalRefunds: 0,
    sourceRefundAmount: 0,
    canonicalRefundAmount: 0,
  };
}

function pushMoneyDiff(
  differences: string[],
  label: string,
  source: number,
  canonical: number,
): void {
  if (source !== canonical) {
    differences.push(`${label}: source ${source}, canonical ${canonical}`);
  }
}
