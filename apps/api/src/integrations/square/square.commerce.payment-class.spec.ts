import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySquareSourcePayment,
  openOrderCashReceiptAmount,
  squarePaymentClassifiableWithoutOrder,
  UNCAPTURED_AUTHORIZED_CARD_MAX_HOLD_MS,
  type SquareUncapturedRecoveryProvenance,
} from "./square.commerce.payment-class";
import { squareOrderEligibleAsHistoricalSale } from "./square.commerce.order";

const OPEN_ORDER = {
  id: "ORDER-OPEN",
  state: "OPEN",
  created_at: "2024-11-15T16:00:00.000Z",
  total_money: { amount: 19972, currency: "CAD" },
};

const SPLIT_ORDER = {
  id: "ORDER-SPLIT",
  state: "OPEN",
  closed_at: null,
  created_at: "2024-11-15T16:26:00.000Z",
  total_money: { amount: 10045, currency: "CAD" },
};

const CLOSED_ORDER = {
  id: "ORDER-CLOSED",
  state: "COMPLETED",
  closed_at: "2026-04-20T16:00:00.000Z",
  total_money: { amount: 1000, currency: "CAD" },
};

function failedCard(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "PAY-FAIL",
    order_id: "ORDER-OPEN",
    status: "FAILED",
    source_type: "CARD",
    amount_money: { amount: 12053, currency: "CAD" },
    approved_money: { amount: 0, currency: "CAD" },
    refunded_money: { amount: 0, currency: "CAD" },
    ...overrides,
  };
}

function canceledCard(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "PAY-VOID",
    order_id: "ORDER-OPEN",
    status: "CANCELED",
    source_type: "CARD",
    amount_money: { amount: 10000, currency: "CAD" },
    approved_money: { amount: 10000, currency: "CAD" },
    refunded_money: { amount: 0, currency: "CAD" },
    ...overrides,
  };
}

function canceledCash(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "PAY-CASH",
    order_id: "ORDER-SPLIT",
    status: "CANCELED",
    source_type: "CASH",
    amount_money: { amount: 45, currency: "CAD" },
    refunded_money: { amount: 0, currency: "CAD" },
    ...overrides,
  };
}

const FAILED_SIBLING_CARD = failedCard({
  id: "PAY-SIBLING-FAIL",
  order_id: "ORDER-SPLIT",
  amount_money: { amount: 10000, currency: "CAD" },
});

test("A. FAILED CARD + approved 0 + no fee/refund + missing order is a safe non-settled attempt", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard(), { saleResolved: false }),
    "failed_non_settled_attempt",
  );
});

test("FAILED CARD with a canonical sale but no canonical payment is still skipped", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard(), {
      saleResolved: true,
      orderPayload: CLOSED_ORDER,
    }),
    "failed_non_settled_attempt",
  );
});

test("FAILED CARD with an existing canonical payment is not reclassified", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard(), {
      saleResolved: true,
      paymentResolved: true,
      orderPayload: CLOSED_ORDER,
    }),
    undefined,
  );
});

test("C. FAILED non-CARD missing-order remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard({ source_type: "CASH" }), {
      saleResolved: false,
    }),
    undefined,
  );
  assert.equal(
    squarePaymentClassifiableWithoutOrder(failedCard({ source_type: "CASH" }), {
      paymentResolved: false,
    }),
    false,
  );
});

test("FAILED CASH on an OPEN order remains a skipped attempt", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard({ source_type: "CASH" }), {
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

test("H. FAILED CARD with approved_money > 0 is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedCard({
        approved_money: { amount: 19972, currency: "CAD" },
      }),
      { saleResolved: false },
    ),
    undefined,
  );
});

test("I. FAILED payment with a processing fee is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedCard({
        processing_fee: [
          { type: "INITIAL", amount_money: { amount: 30, currency: "CAD" } },
        ],
      }),
      { saleResolved: false },
    ),
    undefined,
  );
});

test("J. FAILED payment with refund activity is not skipped", () => {
  assert.equal(
    classifySquareSourcePayment(
      failedCard({
        refunded_money: { amount: 500, currency: "CAD" },
      }),
      { saleResolved: false },
    ),
    undefined,
  );
});

test("K. non-FAILED unresolved payment is not skipped as a failed attempt", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard({ status: "COMPLETED" }), {
      saleResolved: false,
      orderPayload: OPEN_ORDER,
    }),
    undefined,
  );
});

test("D. CANCELED CARD + approved > 0 + no fee/refund is a canceled card void", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCard(), { saleResolved: false }),
    "canceled_card_void",
  );
});

test("E. canceled card void does not require an order and creates no canonical class", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCard(), {
      saleResolved: false,
    }),
    "canceled_card_void",
  );
  assert.equal(
    squarePaymentClassifiableWithoutOrder(canceledCard(), {
      paymentResolved: false,
    }),
    true,
  );
});

test("F. CANCELED CASH does not use the canceled-card rule", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), { saleResolved: false }),
    undefined,
  );
  assert.notEqual(
    classifySquareSourcePayment(canceledCash(), { saleResolved: false }),
    "canceled_card_void",
  );
});

test("G. November split-tender shape is an open-order cash receipt", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), {
      saleResolved: false,
      orderPayload: SPLIT_ORDER,
      siblingPayments: [FAILED_SIBLING_CARD],
    }),
    "open_order_cash_receipt",
  );
});

test("H. open-order cash receipt amount is the source cash amount", () => {
  assert.equal(openOrderCashReceiptAmount(canceledCash()), 45);
});

test("I. open-order cash receipt is not used when a canonical sale already exists", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), {
      saleResolved: true,
      orderPayload: SPLIT_ORDER,
      siblingPayments: [FAILED_SIBLING_CARD],
    }),
    undefined,
  );
});

test("J. cash + sibling card amount must exactly equal the order total", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), {
      saleResolved: false,
      orderPayload: { ...SPLIT_ORDER, total_money: { amount: 10045, currency: "CAD" } },
      siblingPayments: [
        failedCard({
          id: "PAY-SIBLING-FAIL",
          order_id: "ORDER-SPLIT",
          amount_money: { amount: 10000, currency: "CAD" },
        }),
      ],
    }),
    "open_order_cash_receipt",
  );
});

test("K. missing sibling card evidence remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), {
      saleResolved: false,
      orderPayload: SPLIT_ORDER,
      siblingPayments: [],
    }),
    undefined,
  );
});

test("L. mismatched cash/card/order total remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), {
      saleResolved: false,
      orderPayload: SPLIT_ORDER,
      siblingPayments: [
        failedCard({
          id: "PAY-WRONG",
          order_id: "ORDER-SPLIT",
          amount_money: { amount: 9999, currency: "CAD" },
        }),
      ],
    }),
    undefined,
  );
});

test("M. completed/terminal order does not use the open-order cash rule", () => {
  assert.equal(
    classifySquareSourcePayment(canceledCash(), {
      saleResolved: false,
      orderPayload: {
        ...SPLIT_ORDER,
        state: "COMPLETED",
        closed_at: "2024-11-15T20:00:00.000Z",
      },
      siblingPayments: [FAILED_SIBLING_CARD],
    }),
    undefined,
  );
});

test("N. refunded cash remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(
      canceledCash({
        refunded_money: { amount: 45, currency: "CAD" },
      }),
      {
        saleResolved: false,
        orderPayload: SPLIT_ORDER,
        siblingPayments: [FAILED_SIBLING_CARD],
      },
    ),
    undefined,
  );
});

test("O. processing-fee cash remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(
      canceledCash({
        processing_fee: [
          { type: "INITIAL", amount_money: { amount: 3, currency: "CAD" } },
        ],
      }),
      {
        saleResolved: false,
        orderPayload: SPLIT_ORDER,
        siblingPayments: [FAILED_SIBLING_CARD],
      },
    ),
    undefined,
  );
});

test("Q. unknown payment still has no provider-only class", () => {
  assert.equal(
    classifySquareSourcePayment(
      {
        id: "PAY-UNKNOWN",
        status: "COMPLETED",
        source_type: "CARD",
        amount_money: { amount: 1000, currency: "CAD" },
      },
      { saleResolved: false },
    ),
    undefined,
  );
});

test("CLOSED FAILED CASH without an OPEN order remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(failedCard({ source_type: "CASH" }), {
      saleResolved: false,
      orderPayload: CLOSED_ORDER,
    }),
    undefined,
  );
});

function uncapturedCard(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "PAY-AUTH",
    order_id: "ORDER-GONE",
    status: "APPROVED",
    source_type: "CARD",
    created_at: "2023-11-18T18:52:11.113Z",
    amount_money: { amount: 270, currency: "CAD" },
    approved_money: { amount: 270, currency: "CAD" },
    total_money: { amount: 270, currency: "CAD" },
    card_details: {
      status: "AUTHORIZED",
      entry_method: "CONTACTLESS",
      card_payment_timeline: {
        authorized_at: "2023-11-18T18:52:11.340Z",
      },
    },
    ...overrides,
  };
}

const NOW_AFTER_HOLD = new Date("2026-09-29T00:00:00.000Z");
const NOW_WITHIN_HOLD = new Date("2023-11-20T18:52:11.340Z");

function uncapturedContext(
  overrides: Partial<{
    saleResolved: boolean;
    paymentResolved: boolean;
    uncapturedRecovery: SquareUncapturedRecoveryProvenance;
    now: Date;
    orderPayload: Record<string, unknown>;
  }> = {},
) {
  return {
    saleResolved: false,
    uncapturedRecovery: {
      orderRequestedFromSquareAndMissing: true,
      exactPaymentRefreshObserved: true,
    },
    now: NOW_AFTER_HOLD,
    ...overrides,
  };
}

test("A. old APPROVED AUTHORIZED CARD with missing order is uncaptured_authorized_card", () => {
  assert.equal(
    classifySquareSourcePayment(uncapturedCard(), uncapturedContext()),
    "uncaptured_authorized_card",
  );
  assert.equal(
    squarePaymentClassifiableWithoutOrder(uncapturedCard(), {
      paymentResolved: false,
    }),
    false,
  );
});

test("B. recent APPROVED AUTHORIZED CARD remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard(),
      uncapturedContext({ now: NOW_WITHIN_HOLD }),
    ),
    undefined,
  );
});

test("C. APPROVED CARD with captured_at is not uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({
        card_details: {
          status: "AUTHORIZED",
          card_payment_timeline: {
            authorized_at: "2023-11-18T18:52:11.340Z",
            captured_at: "2023-11-18T18:52:12.000Z",
          },
        },
      }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("D. APPROVED CARD with processing fee is not uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({
        processing_fee: [
          { type: "INITIAL", amount_money: { amount: 8, currency: "CAD" } },
        ],
      }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("E. COMPLETED CARD missing order is not uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ status: "COMPLETED" }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("F. old APPROVED CASH is not uncaptured_authorized_card", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ source_type: "CASH" }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("G. old APPROVED EXTERNAL is not uncaptured_authorized_card", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ source_type: "EXTERNAL" }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("H. recovered order context does not uncaptured-classify", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard(),
      uncapturedContext({
        uncapturedRecovery: undefined,
        orderPayload: CLOSED_ORDER,
      }),
    ),
    undefined,
  );
});

test("I. COMPLETED refresh is not uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({
        status: "COMPLETED",
        card_details: {
          status: "CAPTURED",
          card_payment_timeline: {
            authorized_at: "2023-11-18T18:52:11.340Z",
            captured_at: "2023-11-18T18:52:12.000Z",
          },
        },
      }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("J. CANCELED refresh uses canceled card void, not uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({
        status: "CANCELED",
        card_details: { status: "VOIDED" },
      }),
      uncapturedContext(),
    ),
    "canceled_card_void",
  );
});

test("K. FAILED refresh uses failed non-settled when money shape matches", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({
        status: "FAILED",
        approved_money: { amount: 0, currency: "CAD" },
        card_details: { status: "FAILED" },
      }),
      uncapturedContext(),
    ),
    "failed_non_settled_attempt",
  );
});

test("M. delayed_until in the future remains unresolved", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ delayed_until: "2026-10-01T00:00:00.000Z" }),
      uncapturedContext({ now: new Date("2026-09-29T00:00:00.000Z") }),
    ),
    undefined,
  );
});

test("N. delayed_until in the past with other predicates is uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ delayed_until: "2023-11-20T06:52:11.113Z" }),
      uncapturedContext({ now: NOW_AFTER_HOLD }),
    ),
    "uncaptured_authorized_card",
  );
});

test("O. authorized_at plus 7 days not elapsed remains unresolved", () => {
  const authorizedAt = "2023-11-18T18:52:11.340Z";
  const beforeHold = new Date(
    Date.parse(authorizedAt) + UNCAPTURED_AUTHORIZED_CARD_MAX_HOLD_MS,
  );
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard(),
      uncapturedContext({ now: beforeHold }),
    ),
    undefined,
  );
});

test("P. authorized_at plus 7 days elapsed is uncaptured", () => {
  const authorizedAt = "2023-11-18T18:52:11.340Z";
  const afterHold = new Date(
    Date.parse(authorizedAt) + UNCAPTURED_AUTHORIZED_CARD_MAX_HOLD_MS + 1,
  );
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard(),
      uncapturedContext({ now: afterHold }),
    ),
    "uncaptured_authorized_card",
  );
});

test("Q. created_at plus 7 days is used when authorized_at is absent", () => {
  const createdAt = "2023-11-18T18:52:11.113Z";
  const afterHold = new Date(
    Date.parse(createdAt) + UNCAPTURED_AUTHORIZED_CARD_MAX_HOLD_MS + 1,
  );
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({
        created_at: createdAt,
        card_details: { status: "AUTHORIZED" },
      }),
      uncapturedContext({ now: afterHold }),
    ),
    "uncaptured_authorized_card",
  );
});

test("U. latest provided snapshot payload is what classification reads", () => {
  const oldBare = {
    id: "PAY-AUTH",
    order_id: "ORDER-GONE",
    status: "APPROVED",
    source_type: "CARD",
    created_at: "2023-11-18T18:52:11.113Z",
    amount_money: { amount: 270, currency: "CAD" },
    approved_money: { amount: 270, currency: "CAD" },
  };
  assert.equal(
    classifySquareSourcePayment(oldBare, uncapturedContext()),
    undefined,
  );
  assert.equal(
    classifySquareSourcePayment(uncapturedCard(), uncapturedContext()),
    "uncaptured_authorized_card",
  );
});

test("APPROVED CARD without card_details settlement evidence is not uncaptured", () => {
  assert.equal(
    classifySquareSourcePayment(
      {
        id: "PAY-BARE",
        order_id: "ORDER-GONE",
        status: "APPROVED",
        source_type: "CARD",
        created_at: "2023-11-18T18:52:11.113Z",
        amount_money: { amount: 270, currency: "CAD" },
        approved_money: { amount: 270, currency: "CAD" },
      },
      uncapturedContext(),
    ),
    undefined,
  );
});

test("AF. missing local order snapshot is not proven unrecoverable", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard(),
      uncapturedContext({ uncapturedRecovery: undefined }),
    ),
    undefined,
  );
});

test("AG. GetPayment provenance is required even with complete ListPayments evidence", () => {
  const orderMissOnly: SquareUncapturedRecoveryProvenance = {
    orderRequestedFromSquareAndMissing: true,
    exactPaymentRefreshObserved: false,
  };
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard(),
      uncapturedContext({ uncapturedRecovery: orderMissOnly }),
    ),
    undefined,
  );
});

test("AH. delayed_until present but invalid does not fall back to authorized_at", () => {
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ delayed_until: "not-a-timestamp" }),
      uncapturedContext(),
    ),
    undefined,
  );
});

test("AI. exactly delayed_until is not elapsed", () => {
  const delayedUntil = "2023-11-20T06:52:11.113Z";
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ delayed_until: delayedUntil }),
      uncapturedContext({ now: new Date(delayedUntil) }),
    ),
    undefined,
  );
});

test("AJ. one millisecond after delayed_until is elapsed", () => {
  const delayedUntil = "2023-11-20T06:52:11.113Z";
  assert.equal(
    classifySquareSourcePayment(
      uncapturedCard({ delayed_until: delayedUntil }),
      uncapturedContext({
        now: new Date(Date.parse(delayedUntil) + 1),
      }),
    ),
    "uncaptured_authorized_card",
  );
});
