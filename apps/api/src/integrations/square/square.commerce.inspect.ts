import { moneyAmount } from "./square.commerce.money";

export type SquareCommerceInspectSummary = {
  rangeLabel: string;
  sourceOrders: number;
  ordersWithReturns: number;
  ordersWithReturnAmounts: number;
  returnObjectCount: number;
  returnLineItemCount: number;
  returnDiscountCount: number;
  returnTaxCount: number;
  returnServiceChargeCount: number;
  returnTipCount: number;
  returnsWithSourceOrderId: number;
  returnAmountsTotal: number;
  returnAmountsTax: number;
  returnAmountsDiscount: number;
  returnAmountsTip: number;
  returnAmountsServiceCharge: number;
  netAmountsTotal: number;
  netAmountsTax: number;
  netAmountsDiscount: number;
  netAmountsTip: number;
  netAmountsServiceCharge: number;
};

export function inspectSquareOrderSnapshots(
  payloads: Record<string, unknown>[],
  rangeLabel: string,
): SquareCommerceInspectSummary {
  const summary: SquareCommerceInspectSummary = {
    rangeLabel,
    sourceOrders: payloads.length,
    ordersWithReturns: 0,
    ordersWithReturnAmounts: 0,
    returnObjectCount: 0,
    returnLineItemCount: 0,
    returnDiscountCount: 0,
    returnTaxCount: 0,
    returnServiceChargeCount: 0,
    returnTipCount: 0,
    returnsWithSourceOrderId: 0,
    returnAmountsTotal: 0,
    returnAmountsTax: 0,
    returnAmountsDiscount: 0,
    returnAmountsTip: 0,
    returnAmountsServiceCharge: 0,
    netAmountsTotal: 0,
    netAmountsTax: 0,
    netAmountsDiscount: 0,
    netAmountsTip: 0,
    netAmountsServiceCharge: 0,
  };

  for (const payload of payloads) {
    const returns = nestedObjects(payload.returns);
    if (returns.length > 0) {
      summary.ordersWithReturns += 1;
      summary.returnObjectCount += returns.length;
      for (const entry of returns) {
        summary.returnLineItemCount += countValue(entry.return_line_item_count);
        summary.returnDiscountCount += countValue(entry.return_discount_count);
        summary.returnTaxCount += countValue(entry.return_tax_count);
        summary.returnServiceChargeCount += countValue(
          entry.return_service_charge_count,
        );
        summary.returnTipCount += countValue(entry.return_tip_count);
        if (typeof entry.source_order_id === "string" && entry.source_order_id) {
          summary.returnsWithSourceOrderId += 1;
        }
      }
    }
    const returnAmounts = nestedObject(payload.return_amounts);
    if (returnAmounts) {
      summary.ordersWithReturnAmounts += 1;
      summary.returnAmountsTotal += moneyOrZero(returnAmounts.total_money);
      summary.returnAmountsTax += moneyOrZero(returnAmounts.tax_money);
      summary.returnAmountsDiscount += moneyOrZero(returnAmounts.discount_money);
      summary.returnAmountsTip += moneyOrZero(returnAmounts.tip_money);
      summary.returnAmountsServiceCharge += moneyOrZero(
        returnAmounts.service_charge_money,
      );
    }
    const net = nestedObject(payload.net_amounts);
    if (net) {
      summary.netAmountsTotal += moneyOrZero(net.total_money);
      summary.netAmountsTax += moneyOrZero(net.tax_money);
      summary.netAmountsDiscount += moneyOrZero(net.discount_money);
      summary.netAmountsTip += moneyOrZero(net.tip_money);
      summary.netAmountsServiceCharge += moneyOrZero(net.service_charge_money);
    }
  }

  return summary;
}

export function formatSquareCommerceInspect(
  summary: SquareCommerceInspectSummary,
): string {
  return [
    "Square commerce inspect",
    "",
    `Range: ${summary.rangeLabel}`,
    "",
    "Orders",
    `Source orders: ${summary.sourceOrders}`,
    `Orders with returns: ${summary.ordersWithReturns}`,
    `Orders with return_amounts: ${summary.ordersWithReturnAmounts}`,
    "",
    "Returns",
    `Return objects: ${summary.returnObjectCount}`,
    `Return line items: ${summary.returnLineItemCount}`,
    `Return discounts: ${summary.returnDiscountCount}`,
    `Return taxes: ${summary.returnTaxCount}`,
    `Return service charges: ${summary.returnServiceChargeCount}`,
    `Return tips: ${summary.returnTipCount}`,
    `Returns with source_order_id: ${summary.returnsWithSourceOrderId}`,
    "",
    "Return amounts",
    `total: ${summary.returnAmountsTotal}`,
    `tax: ${summary.returnAmountsTax}`,
    `discount: ${summary.returnAmountsDiscount}`,
    `tip: ${summary.returnAmountsTip}`,
    `service charge: ${summary.returnAmountsServiceCharge}`,
    "",
    "Net amounts",
    `total: ${summary.netAmountsTotal}`,
    `tax: ${summary.netAmountsTax}`,
    `discount: ${summary.netAmountsDiscount}`,
    `tip: ${summary.netAmountsTip}`,
    `service charge: ${summary.netAmountsServiceCharge}`,
  ].join("\n");
}

function moneyOrZero(value: unknown): number {
  return moneyAmount(value) ?? 0;
}

function countValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function nestedObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}
