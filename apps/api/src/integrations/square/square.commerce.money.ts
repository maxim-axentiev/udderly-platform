import { squareOrderEligibleAsHistoricalSale } from "./square.commerce.order";

export type SquareMoneyParts = {
  amount: number;
  currency?: string;
};

export type SquareSaleMoney = {
  currency: string;
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  tipAmount: number;
};

export type SquareOrderMoneyClassification =
  | { kind: "sale"; money: SquareSaleMoney }
  | { kind: "return_only"; netTotal: number }
  | { kind: "return_adjustment_non_sale"; netTotal: 0 }
  | { kind: "invalid_order_money" };

/**
 * Classify Square order money for canonical sale mapping.
 *
 * gross sale: usable top-level `total_money`.
 * return-only: missing/unusable gross AND either
 *   (a) valid `net_amounts.total_money` < 0, or
 *   (b) net total missing, empty current lines, explicit return evidence,
 *       and valid positive `return_amounts.total_money` (historical return
 *       rollup; Square stores that total as a positive amount).
 * return-adjustment non-sale: missing/unusable gross, valid net total = 0,
 *   empty current line_items, at least one `returns[]` object, and explicit
 *   return evidence (`return_amounts` and/or returned component counts).
 * invalid order money: anything else that cannot safely be a sale.
 *
 * Do not abs net amounts. Do not treat positive return_amounts as sale
 * revenue. Do not store a $0/negative sale.
 */
export function classifySquareOrderMoney(
  order: Record<string, unknown>,
): SquareOrderMoneyClassification {
  const grossTotal = moneyAmount(order.total_money);
  if (grossTotal === undefined) {
    const netTotal = moneyAmount(nestedObject(order.net_amounts)?.total_money);
    if (netTotal !== undefined && netTotal < 0) {
      return { kind: "return_only", netTotal };
    }
    if (netTotal === 0 && isReturnAdjustmentNonSale(order)) {
      return { kind: "return_adjustment_non_sale", netTotal: 0 };
    }
    if (netTotal === undefined && isPositiveReturnAmountsReturnOnly(order)) {
      return { kind: "return_only", netTotal: 0 };
    }
    return { kind: "invalid_order_money" };
  }

  const money = squareOrderSaleMoney(order);
  if (!money) {
    return { kind: "invalid_order_money" };
  }
  return { kind: "sale", money };
}

function isReturnAdjustmentNonSale(order: Record<string, unknown>): boolean {
  if (nestedArray(order.line_items).length > 0) {
    return false;
  }
  const returns = returnObjects(order);
  if (returns.length === 0) {
    return false;
  }
  if (hasMoneyParts(nestedObject(order.return_amounts))) {
    return true;
  }
  return returns.some(
    (entry) =>
      hasMoneyParts(nestedObject(entry.return_amounts)) ||
      componentCount(entry, "return_line_item_count", "return_line_items") > 0 ||
      componentCount(entry, "return_discount_count", "return_discounts") > 0 ||
      componentCount(entry, "return_tax_count", "return_taxes") > 0 ||
      componentCount(entry, "return_service_charge_count", "return_service_charges") >
        0 ||
      componentCount(entry, "return_tip_count", "return_tips") > 0,
  );
}

/**
 * Historical Square return rollup: no gross, no net, empty current lines,
 * explicit returns[], and a positive valid return_amounts.total_money.
 * Square documents return_amounts.total_money as a positive returned total.
 */
function isPositiveReturnAmountsReturnOnly(
  order: Record<string, unknown>,
): boolean {
  if (!squareOrderEligibleAsHistoricalSale(order)) {
    return false;
  }
  if (nestedArray(order.line_items).length > 0) {
    return false;
  }
  if (returnObjects(order).length === 0) {
    return false;
  }
  const returnedTotal = nestedObject(order.return_amounts)?.total_money;
  const amount = moneyAmount(returnedTotal);
  const currency = moneyCurrency(returnedTotal);
  return amount !== undefined && amount > 0 && currency !== undefined;
}

function returnObjects(order: Record<string, unknown>): Record<string, unknown>[] {
  return nestedArray(order.returns).filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function hasMoneyParts(value: Record<string, unknown> | undefined): boolean {
  if (!value) {
    return false;
  }
  return (
    moneyAmount(value.total_money) !== undefined ||
    moneyAmount(value.tax_money) !== undefined ||
    moneyAmount(value.discount_money) !== undefined ||
    moneyAmount(value.tip_money) !== undefined ||
    moneyAmount(value.service_charge_money) !== undefined
  );
}

function componentCount(
  entry: Record<string, unknown>,
  countKey: string,
  arrayKey: string,
): number {
  const counted = entry[countKey];
  if (typeof counted === "number" && Number.isFinite(counted) && counted > 0) {
    return Math.trunc(counted);
  }
  return nestedArray(entry[arrayKey]).length;
}

function nestedArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Square order-level money → canonical sale (original/gross economics).
 *
 * Use top-level Order totals, not `net_amounts`.
 * `net_amounts` is post-return provider evidence and must not reduce sale
 * fields; refunds are stored separately. Using net sale totals plus refunds
 * would double-count returns in reporting.
 *
 * `order.total_money` includes tip when `total_tip_money` is present.
 * Canonical `sale.total_amount` excludes tip by subtracting that explicit
 * top-level tip once. Never guess a tip. Never subtract processing fees
 * or refunds from the sale.
 *
 * Components (integer minor units, never negative):
 * - discount_amount = total_discount_money
 * - tax_amount = total_tax_money
 * - service_charge_amount = total_service_charge_money
 * - total_amount = total_money - total_tip_money
 * - subtotal_amount = total_amount - tax - service_charge + discount
 */
export function squareOrderSaleMoney(
  order: Record<string, unknown>,
): SquareSaleMoney | undefined {
  const discount = nonNegative(moneyAmount(order.total_discount_money));
  const tax = nonNegative(moneyAmount(order.total_tax_money));
  const serviceCharge = nonNegative(moneyAmount(order.total_service_charge_money));
  const tip = nonNegative(moneyAmount(order.total_tip_money));
  const totalWithTip = moneyAmount(order.total_money);
  if (totalWithTip === undefined) {
    return undefined;
  }

  const currency =
    moneyCurrency(order.total_money) ?? moneyCurrency(order.total_tax_money);
  if (!currency || currency.length !== 3) {
    return undefined;
  }

  const totalAmount = nonNegative(totalWithTip - tip);
  const subtotalAmount = nonNegative(totalAmount - tax - serviceCharge + discount);
  return {
    currency,
    subtotalAmount,
    discountAmount: discount,
    taxAmount: tax,
    serviceChargeAmount: serviceCharge,
    totalAmount,
    tipAmount: tip,
  };
}

export function moneyAmount(value: unknown): number | undefined {
  const money = nestedObject(value);
  if (!money || typeof money.amount !== "number" || !Number.isFinite(money.amount)) {
    return undefined;
  }
  return money.amount;
}

export function moneyCurrency(value: unknown): string | undefined {
  const money = nestedObject(value);
  const currency = money?.currency;
  return typeof currency === "string" && currency.length === 3
    ? currency
    : undefined;
}

export function sanitizeMoney(value: unknown): SquareMoneyParts | undefined {
  const amount = moneyAmount(value);
  if (amount === undefined) {
    return undefined;
  }
  const currency = moneyCurrency(value);
  return currency ? { amount, currency } : { amount };
}

/**
 * Square Payments API `processing_fee[]` (Square-Version 2026-08-19).
 *
 * Confirmed from production (2026-09-12): INITIAL `amount_money.amount` is
 * positive and is merchant processing-fee cost. ADJUSTMENT may be negative.
 *
 *   net_signed = sum(processing_fee[].amount_money.amount)
 *
 * - no entries: no fee
 * - net_signed > 0: canonical cost = net_signed
 * - net_signed = 0: canonical cost = 0 (e.g. fully reversed)
 * - net_signed < 0: net credit; cannot store as nonnegative cost. Report it.
 */
export type ProcessingFeeNet =
  | { status: "none" }
  | { status: "cost"; amount: number }
  | { status: "invalid_net_credit"; netSigned: number };

export function netProcessingFeeCost(value: unknown): ProcessingFeeNet {
  if (!Array.isArray(value)) {
    return { status: "none" };
  }
  let netSigned = 0;
  let seen = false;
  for (const entry of value) {
    const amount = moneyAmount(nestedObject(entry)?.amount_money);
    if (amount === undefined) {
      continue;
    }
    seen = true;
    netSigned += amount;
  }
  if (!seen) {
    return { status: "none" };
  }
  if (netSigned < 0) {
    return { status: "invalid_net_credit", netSigned };
  }
  return { status: "cost", amount: netSigned };
}

export function sanitizeProcessingFees(
  value: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fees: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const payload: Record<string, unknown> = {};
    if (typeof entry.type === "string" && entry.type.trim()) {
      payload.type = entry.type.trim();
    }
    if (typeof entry.effective_at === "string" && entry.effective_at.trim()) {
      payload.effective_at = entry.effective_at.trim();
    }
    const money = sanitizeMoney(entry.amount_money);
    if (money) {
      payload.amount_money = money;
    }
    if (Object.keys(payload).length > 0) {
      fees.push(payload);
    }
  }
  return fees;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function nestedObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
