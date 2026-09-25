import assert from "node:assert/strict";
import test from "node:test";
import { classifySquareSourcePayment } from "./square.commerce.payment-class";
import { squareOrderEligibleAsHistoricalSale } from "./square.commerce.order";

const OPEN_ORDER = {
  id: "ORDER-OPEN",
  state: "OPEN",
  created_at: "2026-05-15T16:00:00.000Z",
  total_money: { amount: 19972, currency: "CAD" },
};

const CLOSED_ORDER = {
  id: "ORDER-CLOSED",
  state: "COMPLETED",
  closed_at: "2026-04-20T16:00:00.000Z",
  total_money: { amount: 1000, currency: "CAD" },
};

function failedPayment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "PAY-FAIL",
    order_id: "ORDER-OPEN",
    status: "FAILED",
    source_type: "CARD",
    amount_money: { amount: 19972, currency: "CAD" },
    approved_money: { amount: 0, currency: "CAD" },
    refunded_money: { amount: 0, currency: "CAD" },
    ...overrides,
  };
}

test("A. FAILED payment + OPEN order + zero approved/refunded/fees is a skipped attempt", () => {
  assert.equal(
    classifySquareSourcePayment(failedPayment(), {
      saleResolved: false,
      orderPayload: OPEN_ORDER,
    }),
    "failed_non_settled_attempt",
  );
});

test("missing approved_money is treated as zero approved", () => {
  assert.equal(
    classifySquareSourcePayment(failedPayment({ approved_money: undefined }), {
      saleResolved: false,
      orderPayload: OPEN_ORDER,
    }),
    "failed_non_settled_attempt",
  );
});

test("B/C. OPEN order is not eligible as a historical sale", () => {
  assert.equal(squareOrderEligibleAsHistoricalSale(OPEN_ORDER), false);
  assert.equal(squareOrderEligibleAsHistoricalSale(CLOSED_ORDER), true);
});

test("H. FAILED payment with approved_money > 0 is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedPayment({
        approved_money: { amount: 19972, currency: "CAD" },
      }),
      { saleResolved: false, orderPayload: OPEN_ORDER },
    ),
    undefined,
  );
});

test("I. FAILED payment with a processing fee is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedPayment({
        processing_fee: [
          { type: "INITIAL", amount_money: { amount: 30, currency: "CAD" } },
        ],
      }),
      { saleResolved: false, orderPayload: OPEN_ORDER },
    ),
    undefined,
  );
});

test("J. FAILED payment with refund activity is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedPayment({
        refunded_money: { amount: 500, currency: "CAD" },
      }),
      { saleResolved: false, orderPayload: OPEN_ORDER },
    ),
    undefined,
  );
});

test("K. non-FAILED unresolved payment is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedPayment({ status: "COMPLETED" }),
      { saleResolved: false, orderPayload: OPEN_ORDER },
    ),
    undefined,
  );
});

test("FAILED payment without recovered order is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(failedPayment(), { saleResolved: false }),
    undefined,
  );
});

test("FAILED payment with a canonical sale dependency is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(failedPayment(), {
      saleResolved: true,
      orderPayload: OPEN_ORDER,
    }),
    undefined,
  );
});

test("CLOSED terminal order is not a failed non-settled attempt", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedPayment({ order_id: "ORDER-CLOSED" }),
      { saleResolved: false, orderPayload: CLOSED_ORDER },
    ),
    undefined,
  );
});
