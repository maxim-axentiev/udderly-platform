import { moneyAmount, moneyCurrency, netProcessingFeeCost } from "./square.commerce.money";
import { squareOrderIsNonterminalOpen } from "./square.commerce.order";

export type SquareSourcePaymentClass =
  | "failed_non_settled_attempt"
  | "canceled_card_void"
  | "open_order_cash_receipt";

export type SquareSourcePaymentClassContext = {
  saleResolved: boolean;
  paymentResolved?: boolean;
  orderPayload?: Record<string, unknown>;
  siblingPayments?: Record<string, unknown>[];
};

/**
 * Provider-only payment classes that never create canonical money.
 * Anything else stays canonicalizable (and fails reconcile if no
 * canonical payment exists).
 */
export function classifySquareSourcePayment(
  payment: Record<string, unknown>,
  context: SquareSourcePaymentClassContext,
): SquareSourcePaymentClass | undefined {
  if (context.paymentResolved) {
    return undefined;
  }
  if (isCanceledCardVoid(payment)) {
    return "canceled_card_void";
  }
  if (isFailedNonSettledCard(payment)) {
    return "failed_non_settled_attempt";
  }
  if (isFailedNonSettledOpenOrderAttempt(payment, context)) {
    return "failed_non_settled_attempt";
  }
  if (isOpenOrderCashReceipt(payment, context)) {
    return "open_order_cash_receipt";
  }
  return undefined;
}

export function squarePaymentClassifiableWithoutOrder(
  payment: Record<string, unknown>,
  options: { paymentResolved: boolean },
): boolean {
  const classified = classifySquareSourcePayment(payment, {
    saleResolved: false,
    paymentResolved: options.paymentResolved,
  });
  return (
    classified === "failed_non_settled_attempt" ||
    classified === "canceled_card_void"
  );
}

export function failedAttemptRequestedAmount(
  payment: Record<string, unknown>,
): number {
  return nonNegative(moneyAmount(payment.amount_money));
}

export function openOrderCashReceiptAmount(
  payment: Record<string, unknown>,
): number {
  return nonNegative(moneyAmount(payment.amount_money));
}

function isCanceledCardVoid(payment: Record<string, unknown>): boolean {
  if (!isCanceledStatus(payment.status)) {
    return false;
  }
  if (sourceType(payment) !== "CARD") {
    return false;
  }
  if (!isMissingOrZeroMoney(payment.refunded_money)) {
    return false;
  }
  if (hasProcessingFeeEvidence(payment)) {
    return false;
  }
  return true;
}

function isFailedNonSettledCard(payment: Record<string, unknown>): boolean {
  if (!isFailedStatus(payment.status)) {
    return false;
  }
  if (sourceType(payment) !== "CARD") {
    return false;
  }
  return hasFailedAttemptMoneyShape(payment);
}

function isFailedNonSettledOpenOrderAttempt(
  payment: Record<string, unknown>,
  context: SquareSourcePaymentClassContext,
): boolean {
  if (context.saleResolved) {
    return false;
  }
  if (!isFailedStatus(payment.status)) {
    return false;
  }
  if (!sourceType(payment)) {
    return false;
  }
  if (!hasFailedAttemptMoneyShape(payment)) {
    return false;
  }
  if (!context.orderPayload) {
    return false;
  }
  return squareOrderIsNonterminalOpen(context.orderPayload);
}

function isOpenOrderCashReceipt(
  payment: Record<string, unknown>,
  context: SquareSourcePaymentClassContext,
): boolean {
  if (context.saleResolved) {
    return false;
  }
  if (!isCanceledStatus(payment.status)) {
    return false;
  }
  if (sourceType(payment) !== "CASH") {
    return false;
  }
  const cashAmount = moneyAmount(payment.amount_money);
  if (cashAmount === undefined || cashAmount <= 0) {
    return false;
  }
  if (!moneyCurrency(payment.amount_money)) {
    return false;
  }
  if (!isMissingOrZeroMoney(payment.refunded_money)) {
    return false;
  }
  if (hasProcessingFeeEvidence(payment)) {
    return false;
  }
  const order = context.orderPayload;
  if (!order || !squareOrderIsNonterminalOpen(order)) {
    return false;
  }
  const orderTotal = moneyAmount(order.total_money);
  if (orderTotal === undefined || orderTotal <= 0) {
    return false;
  }
  if (cashAmount >= orderTotal) {
    return false;
  }
  const siblings = context.siblingPayments ?? [];
  for (const sibling of siblings) {
    const siblingSource = sourceType(sibling);
    const siblingStatus = statusValue(sibling.status);
    if (siblingSource !== "CARD") {
      continue;
    }
    if (siblingStatus !== "FAILED" && siblingStatus !== "CANCELED") {
      continue;
    }
    const siblingAmount = moneyAmount(sibling.amount_money);
    if (siblingAmount === undefined) {
      continue;
    }
    if (siblingAmount + cashAmount === orderTotal) {
      return true;
    }
  }
  return false;
}

function hasFailedAttemptMoneyShape(payment: Record<string, unknown>): boolean {
  if (!isMissingOrZeroMoney(payment.approved_money)) {
    return false;
  }
  if (!isMissingOrZeroMoney(payment.refunded_money)) {
    return false;
  }
  if (hasProcessingFeeEvidence(payment)) {
    return false;
  }
  return true;
}

function isFailedStatus(value: unknown): boolean {
  return statusValue(value) === "FAILED";
}

function isCanceledStatus(value: unknown): boolean {
  return statusValue(value) === "CANCELED";
}

function statusValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : undefined;
}

function sourceType(payment: Record<string, unknown>): string | undefined {
  return statusValue(payment.source_type);
}

function isMissingOrZeroMoney(value: unknown): boolean {
  const amount = moneyAmount(value);
  return amount === undefined || amount === 0;
}

function hasProcessingFeeEvidence(payment: Record<string, unknown>): boolean {
  if (
    Array.isArray(payment.processing_fee) &&
    payment.processing_fee.length > 0
  ) {
    return true;
  }
  if (
    typeof payment.processing_fee_amount === "number" &&
    payment.processing_fee_amount !== 0
  ) {
    return true;
  }
  return netProcessingFeeCost(payment.processing_fee).status !== "none";
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}
