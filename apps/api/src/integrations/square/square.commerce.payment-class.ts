import { moneyAmount, netProcessingFeeCost } from "./square.commerce.money";
import { squareOrderIsNonterminalOpen } from "./square.commerce.order";

export type SquareSourcePaymentClass = "failed_non_settled_attempt";

/**
 * Narrow provider-only class: a failed tender that never moved funds and
 * never closed a sale. All listed evidence must hold. Anything else stays
 * canonicalizable (and fails reconcile if no canonical payment exists).
 */
export function classifySquareSourcePayment(
  payment: Record<string, unknown>,
  context: {
    saleResolved: boolean;
    orderPayload?: Record<string, unknown>;
  },
): SquareSourcePaymentClass | undefined {
  if (context.saleResolved) {
    return undefined;
  }
  if (!isFailedStatus(payment.status)) {
    return undefined;
  }
  if (!stringValue(payment.source_type)) {
    return undefined;
  }
  if (!isMissingOrZeroMoney(payment.approved_money)) {
    return undefined;
  }
  if (!isMissingOrZeroMoney(payment.refunded_money)) {
    return undefined;
  }
  if (hasProcessingFeeEvidence(payment)) {
    return undefined;
  }
  if (!context.orderPayload) {
    return undefined;
  }
  if (!squareOrderIsNonterminalOpen(context.orderPayload)) {
    return undefined;
  }
  return "failed_non_settled_attempt";
}

export function failedAttemptRequestedAmount(
  payment: Record<string, unknown>,
): number {
  return nonNegative(moneyAmount(payment.amount_money));
}

function isFailedStatus(value: unknown): boolean {
  return (
    typeof value === "string" && value.trim().toUpperCase() === "FAILED"
  );
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}
