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

/**
 * Square order-level money → canonical sale.
 *
 * Prefer `net_amounts` (Orders API). Fall back to top-level `total_*` fields.
 *
 * `net_amounts.total_money` includes tip when `tip_money` is present.
 * Canonical `sale.total_amount` excludes tip by subtracting that explicit
 * `tip_money` once. Never guess a tip. Never subtract processing fees.
 *
 * Components (all integer minor units, never negative):
 * - discount_amount = net_amounts.discount_money
 * - tax_amount = net_amounts.tax_money
 * - service_charge_amount = net_amounts.service_charge_money
 * - total_amount = total_money - tip_money
 * - subtotal_amount = total_amount - tax - service_charge + discount
 *   (reconstruction from those explicit net_amounts fields; Square has no
 *   separate order subtotal)
 */
export function squareOrderSaleMoney(
  order: Record<string, unknown>,
): SquareSaleMoney | undefined {
  const net = nestedObject(order.net_amounts);
  const discount = nonNegative(
    moneyAmount(net?.discount_money) ?? moneyAmount(order.total_discount_money),
  );
  const tax = nonNegative(
    moneyAmount(net?.tax_money) ?? moneyAmount(order.total_tax_money),
  );
  const serviceCharge = nonNegative(
    moneyAmount(net?.service_charge_money) ??
      moneyAmount(order.total_service_charge_money),
  );
  const tip = nonNegative(
    moneyAmount(net?.tip_money) ?? moneyAmount(order.total_tip_money),
  );
  const totalWithTip = moneyAmount(net?.total_money) ?? moneyAmount(order.total_money);
  if (totalWithTip === undefined) {
    return undefined;
  }

  const currency =
    moneyCurrency(net?.total_money) ??
    moneyCurrency(order.total_money) ??
    moneyCurrency(net?.tax_money);
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
 * Each entry has a signed `amount_money` and `type` (`INITIAL` | `ADJUSTMENT`).
 * Negative amounts are money taken from the merchant (fee cost).
 * Positive amounts are money returned (fee reversal / adjustment).
 *
 * Canonical cost is the nonnegative net:
 *   net_signed = sum(amount_money.amount)
 *   cost       = -net_signed   when net_signed <= 0
 *
 * A positive net_signed is a net credit to the merchant, which cannot be stored
 * as a nonnegative fee cost. That case is reported, not clamped to 0.
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
  if (netSigned > 0) {
    return { status: "invalid_net_credit", netSigned };
  }
  return { status: "cost", amount: netSigned === 0 ? 0 : -netSigned };
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
