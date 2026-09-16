import assert from "node:assert/strict";
import test from "node:test";
import { netProcessingFeeCost } from "./square.commerce.money";
import { sanitizeSquarePayment } from "./square.commerce.sanitize";

function fee(
  amount: number,
  type: string,
): Record<string, unknown> {
  return {
    type,
    amount_money: { amount, currency: "CAD" },
  };
}

test("A. positive INITIAL fee is the canonical cost", () => {
  assert.deepEqual(netProcessingFeeCost([fee(30, "INITIAL")]), {
    status: "cost",
    amount: 30,
  });
});

test("B. multiple positive fees sum", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(20, "INITIAL"), fee(10, "INITIAL")]),
    { status: "cost", amount: 30 },
  );
});

test("C. positive INITIAL plus negative partial adjustment nets", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(300, "INITIAL"), fee(-100, "ADJUSTMENT")]),
    { status: "cost", amount: 200 },
  );
});

test("D. full reversal is zero cost", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(300, "INITIAL"), fee(-300, "ADJUSTMENT")]),
    { status: "cost", amount: 0 },
  );
});

test("E. net negative credit is not representable as a nonnegative cost", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(300, "INITIAL"), fee(-400, "ADJUSTMENT")]),
    { status: "invalid_net_credit", netSigned: -100 },
  );
});

test("F. no fee entries is none", () => {
  assert.deepEqual(netProcessingFeeCost(undefined), { status: "none" });
  assert.deepEqual(netProcessingFeeCost([]), { status: "none" });
});

test("G. real-shape positive INITIAL example", () => {
  const sanitized = sanitizeSquarePayment({
    id: "P1",
    order_id: "O1",
    status: "COMPLETED",
    amount_money: { amount: 400, currency: "CAD" },
    processing_fee: [
      {
        type: "INITIAL",
        amount_money: { amount: 572, currency: "CAD" },
      },
    ],
  });
  assert.equal(sanitized?.processing_fee_amount, 572);
  const fees = sanitized?.processing_fee as Record<string, unknown>[];
  assert.equal(fees[0]?.type, "INITIAL");
  assert.deepEqual(fees[0]?.amount_money, { amount: 572, currency: "CAD" });
});

test("H. payment amount and tip stay separate from fees", () => {
  const sanitized = sanitizeSquarePayment({
    id: "P1",
    order_id: "O1",
    status: "COMPLETED",
    amount_money: { amount: 1000, currency: "CAD" },
    tip_money: { amount: 100, currency: "CAD" },
    total_money: { amount: 1100, currency: "CAD" },
    processing_fee: [fee(30, "INITIAL")],
  });
  assert.deepEqual(sanitized?.amount_money, { amount: 1000, currency: "CAD" });
  assert.deepEqual(sanitized?.tip_money, { amount: 100, currency: "CAD" });
  assert.equal(sanitized?.processing_fee_amount, 30);
  assert.equal("total_money" in (sanitized ?? {}), true);
});
