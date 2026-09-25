/**
 * Historical Square sale eligibility. Monthly import selects orders by
 * `closed_at`; OPEN/DRAFT carts without `closed_at` are not terminal sales.
 */
export function squareOrderEligibleAsHistoricalSale(
  order: Record<string, unknown>,
): boolean {
  if (!stringValue(order.closed_at)) {
    return false;
  }
  const state = stringValue(order.state)?.toUpperCase();
  if (!state || state === "OPEN" || state === "DRAFT") {
    return false;
  }
  return true;
}

export function squareOrderIsNonterminalOpen(
  order: Record<string, unknown>,
): boolean {
  const state = stringValue(order.state)?.toUpperCase();
  if (state !== "OPEN" && state !== "DRAFT") {
    return false;
  }
  return !stringValue(order.closed_at);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
