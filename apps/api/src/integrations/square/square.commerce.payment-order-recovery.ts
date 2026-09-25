import { moneyAmount } from "./square.commerce.money";
import { SQUARE_ORDERS_BATCH_RETRIEVE_LIMIT } from "./square.constants";
import { instantInUtcRange, type SquareFarmWindow } from "./square.range";
import type { SquareUtcRange } from "./square.types";

export type MissingPaymentOrderDependency = {
  paymentId: string;
  orderId: string;
  amount: number;
};

export type PaymentOrderRecoveryDiscovery = {
  unresolvedPayments: number;
  distinctMissingOrderIds: string[];
  paymentAmountAwaitingDependency: number;
};

export type PaymentOrderClosedAtDistribution = {
  closedBeforeWindow: number;
  closedInsideWindow: number;
  closedAfterWindow: number;
  missingClosedAt: number;
};

export type PaymentOrderRecoveryPersistSummary = {
  ordersRequested: number;
  ordersReturned: number;
  ordersMissing: number;
  snapshotsInserted: number;
  snapshotsUnchanged: number;
  closedAt: PaymentOrderClosedAtDistribution;
};

export function discoverMissingPaymentOrderDependencies(
  payments: { externalId: string; payload: Record<string, unknown> }[],
  options: {
    resolvedPaymentIds: Set<string>;
    orderSnapshotIds: Set<string>;
  },
): PaymentOrderRecoveryDiscovery {
  const missingOrders = new Map<string, number>();
  let unresolvedPayments = 0;
  let paymentAmountAwaitingDependency = 0;

  for (const payment of payments) {
    const orderId = stringValue(payment.payload.order_id);
    if (!orderId) {
      continue;
    }
    if (options.resolvedPaymentIds.has(payment.externalId)) {
      continue;
    }
    if (options.orderSnapshotIds.has(orderId)) {
      continue;
    }
    unresolvedPayments += 1;
    const amount = nonNegative(moneyAmount(payment.payload.amount_money));
    paymentAmountAwaitingDependency += amount;
    missingOrders.set(orderId, (missingOrders.get(orderId) ?? 0) + 1);
  }

  return {
    unresolvedPayments,
    distinctMissingOrderIds: [...missingOrders.keys()],
    paymentAmountAwaitingDependency,
  };
}

export function chunkOrderIds(
  orderIds: string[],
  limit = SQUARE_ORDERS_BATCH_RETRIEVE_LIMIT,
): string[][] {
  const unique = [...new Set(orderIds.filter((id) => id.length > 0))];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += limit) {
    chunks.push(unique.slice(index, index + limit));
  }
  return chunks;
}

export function summarizeRetrievedOrders(
  requestedIds: string[],
  returnedOrders: Record<string, unknown>[],
  paymentWindow: SquareUtcRange,
): {
  returnedIds: Set<string>;
  missingIds: string[];
  closedAt: PaymentOrderClosedAtDistribution;
} {
  const requested = [...new Set(requestedIds.filter((id) => id.length > 0))];
  const returnedIds = new Set<string>();
  const closedAt: PaymentOrderClosedAtDistribution = {
    closedBeforeWindow: 0,
    closedInsideWindow: 0,
    closedAfterWindow: 0,
    missingClosedAt: 0,
  };

  for (const order of returnedOrders) {
    const id = stringValue(order.id);
    if (!id) {
      continue;
    }
    returnedIds.add(id);
    const closed = stringValue(order.closed_at);
    if (!closed) {
      closedAt.missingClosedAt += 1;
      continue;
    }
    if (instantInUtcRange(closed, paymentWindow)) {
      closedAt.closedInsideWindow += 1;
    } else if (Date.parse(closed) < Date.parse(paymentWindow.startAt)) {
      closedAt.closedBeforeWindow += 1;
    } else {
      closedAt.closedAfterWindow += 1;
    }
  }

  return {
    returnedIds,
    missingIds: requested.filter((id) => !returnedIds.has(id)),
    closedAt,
  };
}

export function formatPaymentOrderRecoveryDiscovery(
  discovery: PaymentOrderRecoveryDiscovery,
  window: SquareFarmWindow,
): string {
  const range =
    "date" in window
      ? `${window.date} to ${window.date}`
      : `${window.from} to ${window.to}`;
  return [
    "Square payment order dependency recovery",
    "",
    `Range: ${range}`,
    "",
    `Unresolved payments: ${discovery.unresolvedPayments}`,
    `Distinct missing order dependencies: ${discovery.distinctMissingOrderIds.length}`,
    `Payment amount awaiting dependency: ${discovery.paymentAmountAwaitingDependency}`,
  ].join("\n");
}

export function formatPaymentOrderRecoveryResult(
  discovery: PaymentOrderRecoveryDiscovery,
  persist: PaymentOrderRecoveryPersistSummary,
  window: SquareFarmWindow,
): string {
  return [
    formatPaymentOrderRecoveryDiscovery(discovery, window),
    "",
    `Orders requested: ${persist.ordersRequested}`,
    `Orders returned: ${persist.ordersReturned}`,
    `Orders missing: ${persist.ordersMissing}`,
    "",
    `Closed before requested payment window: ${persist.closedAt.closedBeforeWindow}`,
    `Closed inside requested payment window: ${persist.closedAt.closedInsideWindow}`,
    `Closed after requested payment window: ${persist.closedAt.closedAfterWindow}`,
    `Missing closed_at: ${persist.closedAt.missingClosedAt}`,
    "",
    `Snapshots inserted: ${persist.snapshotsInserted}`,
    `Snapshots unchanged: ${persist.snapshotsUnchanged}`,
  ].join("\n");
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
