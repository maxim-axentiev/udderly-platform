import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkOrderIds,
  discoverMissingPaymentOrderDependencies,
  formatPaymentOrderRecoveryDiscovery,
  formatPaymentOrderRecoveryResult,
  summarizeRetrievedOrders,
} from "./square.commerce.payment-order-recovery";
import { squareFarmUtcRange } from "./square.range";

const WINDOW = { from: "2026-05-01", to: "2026-05-31" } as const;
const RANGE = squareFarmUtcRange(WINDOW);

function payment(
  id: string,
  orderId: string | undefined,
  amount: number,
): { externalId: string; payload: Record<string, unknown> } {
  return {
    externalId: id,
    payload: {
      id,
      ...(orderId ? { order_id: orderId } : {}),
      amount_money: { amount, currency: "CAD" },
    },
  };
}

test("A. unresolved payment with missing order snapshot is discovered", () => {
  const discovery = discoverMissingPaymentOrderDependencies(
    [payment("PAY-A", "ORDER-A", 19972)],
    {
      resolvedPaymentIds: new Set(),
      orderSnapshotIds: new Set(),
    },
  );
  assert.equal(discovery.unresolvedPayments, 1);
  assert.deepEqual(discovery.distinctMissingOrderIds, ["ORDER-A"]);
  assert.equal(discovery.paymentAmountAwaitingDependency, 19972);
});

test("B. resolved payment is ignored", () => {
  const discovery = discoverMissingPaymentOrderDependencies(
    [payment("PAY-B", "ORDER-B", 500)],
    {
      resolvedPaymentIds: new Set(["PAY-B"]),
      orderSnapshotIds: new Set(),
    },
  );
  assert.equal(discovery.unresolvedPayments, 0);
  assert.equal(discovery.distinctMissingOrderIds.length, 0);
});

test("C. duplicate payments referencing the same missing order fetch it once", () => {
  const discovery = discoverMissingPaymentOrderDependencies(
    [
      payment("PAY-C1", "ORDER-C", 100),
      payment("PAY-C2", "ORDER-C", 200),
    ],
    {
      resolvedPaymentIds: new Set(),
      orderSnapshotIds: new Set(),
    },
  );
  assert.equal(discovery.unresolvedPayments, 2);
  assert.deepEqual(discovery.distinctMissingOrderIds, ["ORDER-C"]);
  assert.equal(discovery.paymentAmountAwaitingDependency, 300);
});

test("payments with an existing order snapshot are not fetched", () => {
  const discovery = discoverMissingPaymentOrderDependencies(
    [payment("PAY-D", "ORDER-D", 100)],
    {
      resolvedPaymentIds: new Set(),
      orderSnapshotIds: new Set(["ORDER-D"]),
    },
  );
  assert.equal(discovery.unresolvedPayments, 0);
  assert.equal(discovery.distinctMissingOrderIds.length, 0);
});

test("payments without order_id are not discovered", () => {
  const discovery = discoverMissingPaymentOrderDependencies(
    [payment("PAY-E", undefined, 100)],
    {
      resolvedPaymentIds: new Set(),
      orderSnapshotIds: new Set(),
    },
  );
  assert.equal(discovery.unresolvedPayments, 0);
});

test("E. order ids batch in groups of 100", () => {
  const ids = Array.from({ length: 101 }, (_, index) => `ORDER-${index}`);
  const chunks = chunkOrderIds(ids);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.length, 100);
  assert.equal(chunks[1]?.length, 1);
  assert.deepEqual(chunks[1], ["ORDER-100"]);
});

test("F. missing returned order is reported, not fabricated", () => {
  const summary = summarizeRetrievedOrders(
    ["ORDER-KEEP", "ORDER-MISSING"],
    [{ id: "ORDER-KEEP", closed_at: "2026-05-10T16:00:00.000Z" }],
    RANGE,
  );
  assert.deepEqual([...summary.returnedIds], ["ORDER-KEEP"]);
  assert.deepEqual(summary.missingIds, ["ORDER-MISSING"]);
  assert.equal(summary.closedAt.closedInsideWindow, 1);
});

test("closed_at is distributed against the requested payment window", () => {
  const summary = summarizeRetrievedOrders(
    ["BEFORE", "INSIDE", "AFTER", "NONE"],
    [
      { id: "BEFORE", closed_at: "2026-04-20T16:00:00.000Z" },
      { id: "INSIDE", closed_at: "2026-05-10T16:00:00.000Z" },
      { id: "AFTER", closed_at: "2026-06-02T16:00:00.000Z" },
      { id: "NONE" },
    ],
    RANGE,
  );
  assert.equal(summary.closedAt.closedBeforeWindow, 1);
  assert.equal(summary.closedAt.closedInsideWindow, 1);
  assert.equal(summary.closedAt.closedAfterWindow, 1);
  assert.equal(summary.closedAt.missingClosedAt, 1);
  assert.equal(summary.missingIds.length, 0);
});

test("safe reports omit payment and order ids", () => {
  const discovery = discoverMissingPaymentOrderDependencies(
    [payment("PAY-SECRET", "ORDER-SECRET", 19972)],
    {
      resolvedPaymentIds: new Set(),
      orderSnapshotIds: new Set(),
    },
  );
  const report = formatPaymentOrderRecoveryResult(
    discovery,
    {
      ordersRequested: 1,
      ordersReturned: 1,
      ordersMissing: 0,
      snapshotsInserted: 1,
      snapshotsUnchanged: 0,
      closedAt: {
        closedBeforeWindow: 1,
        closedInsideWindow: 0,
        closedAfterWindow: 0,
        missingClosedAt: 0,
      },
    },
    WINDOW,
  );
  const discoveryReport = formatPaymentOrderRecoveryDiscovery(discovery, WINDOW);
  assert.match(discoveryReport, /Range: 2026-05-01 to 2026-05-31/);
  assert.match(report, /Unresolved payments: 1/);
  assert.match(report, /Distinct missing order dependencies: 1/);
  assert.match(report, /Payment amount awaiting dependency: 19972/);
  assert.match(report, /Closed before requested payment window: 1/);
  assert.equal(report.includes("PAY-SECRET"), false);
  assert.equal(report.includes("ORDER-SECRET"), false);
});
