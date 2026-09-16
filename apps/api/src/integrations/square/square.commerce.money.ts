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
  | { kind: "invalid_order_money" };

/**
 * Classify Square order money for canonical sale mapping.
 *
 * Return-only (provider evidence, not a sale): top-level `total_money` amount
 * is absent/unusable AND `net_amounts.total_money` is a finite amount < 0.
 * Do not abs that net, do not store a $0/negative sale.
 *
 * Missing gross with zero, positive, or unreadable net is invalid order money,
 * not return-only.
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
    return { kind: "invalid_order_money" };
  }

  const money = squareOrderSaleMoney(order);
  if (!money) {
    return { kind: "invalid_order_money" };
  }
  return { kind: "sale", money };
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
