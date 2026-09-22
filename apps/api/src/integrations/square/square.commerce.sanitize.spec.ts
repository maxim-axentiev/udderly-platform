import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySquareOrderMoney,
  squareOrderSaleMoney,
} from "./square.commerce.money";
import {
  sanitizeSquareOrder,
  sanitizeSquarePayment,
  sanitizeSquareRefund,
} from "./square.commerce.sanitize";
import { squarePaymentMethod } from "./square.commerce.status";

test("sale total excludes explicit Square tip once", () => {
  const money = squareOrderSaleMoney({
    total_money: { amount: 1100, currency: "CAD" },
    total_tax_money: { amount: 50, currency: "CAD" },
    total_discount_money: { amount: 100, currency: "CAD" },
    total_tip_money: { amount: 100, currency: "CAD" },
    total_service_charge_money: { amount: 25, currency: "CAD" },
  });
  assert.equal(money?.currency, "CAD");
  assert.equal(money?.totalAmount, 1000);
  assert.equal(money?.tipAmount, 100);
  assert.equal(money?.taxAmount, 50);
  assert.equal(money?.discountAmount, 100);
  assert.equal(money?.serviceChargeAmount, 25);
  assert.equal(money?.subtotalAmount, 1025);
});

test("net_amounts after a return do not reduce canonical sale fields", () => {
  const money = squareOrderSaleMoney({
    total_money: { amount: 10500, currency: "CAD" },
    total_tax_money: { amount: 1300, currency: "CAD" },
    total_discount_money: { amount: 0, currency: "CAD" },
    total_tip_money: { amount: 500, currency: "CAD" },
    total_service_charge_money: { amount: 0, currency: "CAD" },
    net_amounts: {
      total_money: { amount: 8000, currency: "CAD" },
      tax_money: { amount: 1000, currency: "CAD" },
      tip_money: { amount: 500, currency: "CAD" },
    },
  });
  assert.equal(money?.totalAmount, 10000);
  assert.equal(money?.taxAmount, 1300);
  assert.equal(money?.tipAmount, 500);
});

test("A. gross Square order classifies as a sale", () => {
  const classified = classifySquareOrderMoney({
    total_money: { amount: 1100, currency: "CAD" },
    total_tip_money: { amount: 100, currency: "CAD" },
    total_tax_money: { amount: 50, currency: "CAD" },
  });
  assert.equal(classified.kind, "sale");
  if (classified.kind === "sale") {
    assert.equal(classified.money.totalAmount, 1000);
  }
});

test("B. lower net_amounts still classifies as original gross sale", () => {
  const classified = classifySquareOrderMoney({
    total_money: { amount: 10500, currency: "CAD" },
    total_tax_money: { amount: 1300, currency: "CAD" },
    total_tip_money: { amount: 500, currency: "CAD" },
    net_amounts: { total_money: { amount: 8000, currency: "CAD" } },
  });
  assert.equal(classified.kind, "sale");
  if (classified.kind === "sale") {
    assert.equal(classified.money.totalAmount, 10000);
    assert.equal(classified.money.taxAmount, 1300);
  }
});

test("C. missing gross total plus negative net is return-only, not a $0 sale", () => {
  const classified = classifySquareOrderMoney({
    net_amounts: {
      total_money: { amount: -1525, currency: "CAD" },
      tax_money: { amount: -175, currency: "CAD" },
    },
  });
  assert.equal(classified.kind, "return_only");
  if (classified.kind === "return_only") {
    assert.equal(classified.netTotal, -1525);
  }
  assert.equal(
    squareOrderSaleMoney({
      net_amounts: { total_money: { amount: -1525, currency: "CAD" } },
    }),
    undefined,
  );
});

test("D. missing gross with zero, positive, or unreadable net is invalid order money", () => {
  assert.equal(
    classifySquareOrderMoney({
      net_amounts: { total_money: { amount: 0, currency: "CAD" } },
    }).kind,
    "invalid_order_money",
  );
  assert.equal(
    classifySquareOrderMoney({
      net_amounts: { total_money: { amount: 100, currency: "CAD" } },
    }).kind,
    "invalid_order_money",
  );
  assert.equal(classifySquareOrderMoney({}).kind, "invalid_order_money");
  assert.equal(
    classifySquareOrderMoney({
      net_amounts: { total_money: { amount: "nope" } },
    }).kind,
    "invalid_order_money",
  );
  assert.equal(
    classifySquareOrderMoney({
      net_amounts: {
        total_money: { amount: 0, currency: "CAD" },
        tax_money: { amount: 0, currency: "CAD" },
        discount_money: { amount: -1375, currency: "CAD" },
        tip_money: { amount: 0, currency: "CAD" },
        service_charge_money: { amount: 0, currency: "CAD" },
      },
      return_amounts: {
        discount_money: { amount: 1375, currency: "CAD" },
      },
      returns: [{ uid: "r1" }],
    }).kind,
    "invalid_order_money",
  );
});

test("sanitizes return-only order as snapshot evidence with negative net", () => {
  const sanitized = sanitizeSquareOrder({
    id: "RET1",
    location_id: "L1",
    state: "COMPLETED",
    created_at: "2026-09-15T12:00:00Z",
    net_amounts: {
      total_money: { amount: -1525, currency: "CAD" },
      tax_money: { amount: -175, currency: "CAD" },
    },
  });
  assert.equal(sanitized?.id, "RET1");
  assert.equal("total_money" in (sanitized ?? {}), false);
  assert.deepEqual(sanitized?.net_amounts, {
    total_money: { amount: -1525, currency: "CAD" },
    tax_money: { amount: -175, currency: "CAD" },
  });
});

test("sanitizes order without customer contact or notes", () => {
  const sanitized = sanitizeSquareOrder({
    id: "O1",
    location_id: "L1",
    state: "COMPLETED",
    created_at: "2026-09-15T12:00:00Z",
    customer_id: "C1",
    note: "do not persist",
    total_money: { amount: 500, currency: "CAD" },
    total_tip_money: { amount: 0, currency: "CAD" },
    net_amounts: {
      total_money: { amount: 500, currency: "CAD" },
      tip_money: { amount: 0, currency: "CAD" },
    },
    line_items: [
      {
        uid: "U1",
        name: "Gouda",
        quantity: "1.5",
        catalog_object_id: "V1",
        note: "customer note",
        total_money: { amount: 500, currency: "CAD" },
      },
    ],
    tenders: [{ id: "T1", type: "CARD", payment_id: "P1", card_details: {} }],
  });
  assert.equal(sanitized?.id, "O1");
  assert.equal(sanitized?.customer_id, "C1");
  assert.equal("note" in (sanitized ?? {}), false);
  const lines = sanitized?.line_items as Record<string, unknown>[];
  assert.equal("note" in (lines[0] ?? {}), false);
  const tenders = sanitized?.tenders as Record<string, unknown>[];
  assert.deepEqual(Object.keys(tenders[0] ?? {}).sort(), [
    "id",
    "payment_id",
    "type",
  ]);
});

test("sanitizes payment without card, fingerprint, or receipt URL", () => {
  const sanitized = sanitizeSquarePayment({
    id: "P1",
    order_id: "O1",
    status: "COMPLETED",
    source_type: "CARD",
    amount_money: { amount: 400, currency: "CAD" },
    tip_money: { amount: 100, currency: "CAD" },
    processing_fee: [
      { type: "INITIAL", amount_money: { amount: 30, currency: "CAD" } },
    ],
    card_details: { fingerprint: "secret", card: { last_4: "1111" } },
    receipt_url: "https://example.invalid/receipt",
    buyer_email_address: "x@example.invalid",
    billing_address: { address_line_1: "1 Main" },
  });
  assert.equal(sanitized?.processing_fee_amount, 30);
  const fees = sanitized?.processing_fee as Record<string, unknown>[];
  assert.equal(fees[0]?.type, "INITIAL");
  assert.deepEqual(fees[0]?.amount_money, { amount: 30, currency: "CAD" });
  assert.equal("card_details" in (sanitized ?? {}), false);
  assert.equal("receipt_url" in (sanitized ?? {}), false);
  assert.equal("buyer_email_address" in (sanitized ?? {}), false);
  assert.equal("billing_address" in (sanitized ?? {}), false);
});

test("sanitizes refund without reason text", () => {
  const sanitized = sanitizeSquareRefund({
    id: "R1",
    payment_id: "P1",
    order_id: "O1",
    status: "COMPLETED",
    amount_money: { amount: 200, currency: "CAD" },
    reason: "customer complaint",
  });
  assert.deepEqual(sanitized?.amount_money, { amount: 200, currency: "CAD" });
  assert.equal("reason" in (sanitized ?? {}), false);
});

test("maps card cash and external methods", () => {
  assert.equal(squarePaymentMethod("CARD"), "card");
  assert.equal(squarePaymentMethod("CASH"), "cash");
  assert.equal(squarePaymentMethod("EXTERNAL"), "external");
  assert.equal(squarePaymentMethod("WALLET"), "other");
});

function leakyReturn(): Record<string, unknown> {
  return {
    uid: "RET-UID",
    source_order_id: "SRC-ORDER-1",
    note: "do not persist",
    customer_id: "C-SECRET",
    return_amounts: {
      total_money: { amount: 0, currency: "CAD" },
      tax_money: { amount: 0, currency: "CAD" },
      discount_money: { amount: 1375, currency: "CAD" },
      tip_money: { amount: 0, currency: "CAD" },
      service_charge_money: { amount: 0, currency: "CAD" },
    },
    return_line_items: [
      {
        uid: "RL1",
        name: "Secret Cheese Name",
        quantity: "1",
        note: "allergy",
      },
    ],
    return_discounts: [{ uid: "RD1", name: "Staff discount", amount_money: { amount: 1375 } }],
    return_taxes: [{ uid: "RT1", name: "HST" }],
    return_service_charges: [{ uid: "RS1", name: "fee" }],
    return_tips: [{ uid: "RP1", name: "tip" }],
  };
}

test("sanitizes top-level return_amounts and safe return summaries", () => {
  const sanitized = sanitizeSquareOrder({
    id: "O-RET",
    location_id: "L1",
    state: "COMPLETED",
    created_at: "2026-08-28T12:00:00Z",
    email_address: "leak@example.invalid",
    return_amounts: {
      total_money: { amount: 0, currency: "CAD" },
      tax_money: { amount: 0, currency: "CAD" },
      discount_money: { amount: 1375, currency: "CAD" },
      tip_money: { amount: 0, currency: "CAD" },
      service_charge_money: { amount: 0, currency: "CAD" },
    },
    net_amounts: {
      total_money: { amount: 0, currency: "CAD" },
      tax_money: { amount: 0, currency: "CAD" },
      discount_money: { amount: -1375, currency: "CAD" },
      tip_money: { amount: 0, currency: "CAD" },
      service_charge_money: { amount: 0, currency: "CAD" },
    },
    returns: [leakyReturn()],
  });
  assert.deepEqual(sanitized?.return_amounts, {
    total_money: { amount: 0, currency: "CAD" },
    tax_money: { amount: 0, currency: "CAD" },
    discount_money: { amount: 1375, currency: "CAD" },
    tip_money: { amount: 0, currency: "CAD" },
    service_charge_money: { amount: 0, currency: "CAD" },
  });
  const returns = sanitized?.returns as Record<string, unknown>[];
  assert.equal(returns.length, 1);
  assert.equal(returns[0]?.uid, "RET-UID");
  assert.equal(returns[0]?.source_order_id, "SRC-ORDER-1");
  assert.equal(returns[0]?.return_line_item_count, 1);
  assert.equal(returns[0]?.return_discount_count, 1);
  assert.equal(returns[0]?.return_tax_count, 1);
  assert.equal(returns[0]?.return_service_charge_count, 1);
  assert.equal(returns[0]?.return_tip_count, 1);
  assert.deepEqual(Object.keys(returns[0] ?? {}).sort(), [
    "return_amounts",
    "return_discount_count",
    "return_line_item_count",
    "return_service_charge_count",
    "return_tax_count",
    "return_tip_count",
    "source_order_id",
    "uid",
  ]);
  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes("Secret Cheese Name"), false);
  assert.equal(serialized.includes("Staff discount"), false);
  assert.equal(serialized.includes("do not persist"), false);
  assert.equal(serialized.includes("allergy"), false);
  assert.equal(serialized.includes("leak@example.invalid"), false);
  assert.equal(serialized.includes("C-SECRET"), false);
  assert.equal("email_address" in (sanitized ?? {}), false);
});
