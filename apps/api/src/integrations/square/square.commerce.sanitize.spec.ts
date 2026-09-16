import assert from "node:assert/strict";
import test from "node:test";
import { squareOrderSaleMoney } from "./square.commerce.money";
import {
  sanitizeSquareOrder,
  sanitizeSquarePayment,
  sanitizeSquareRefund,
} from "./square.commerce.sanitize";
import { squarePaymentMethod } from "./square.commerce.status";

test("sale total excludes explicit Square tip once", () => {
  const money = squareOrderSaleMoney({
    net_amounts: {
      total_money: { amount: 1100, currency: "CAD" },
      tax_money: { amount: 50, currency: "CAD" },
      discount_money: { amount: 100, currency: "CAD" },
      tip_money: { amount: 100, currency: "CAD" },
      service_charge_money: { amount: 25, currency: "CAD" },
    },
  });
  assert.equal(money?.currency, "CAD");
  assert.equal(money?.totalAmount, 1000);
  assert.equal(money?.tipAmount, 100);
  assert.equal(money?.taxAmount, 50);
  assert.equal(money?.discountAmount, 100);
  assert.equal(money?.serviceChargeAmount, 25);
  assert.equal(money?.subtotalAmount, 1025);
});

test("sanitizes order without customer contact or notes", () => {
  const sanitized = sanitizeSquareOrder({
    id: "O1",
    location_id: "L1",
    state: "COMPLETED",
    created_at: "2026-09-15T12:00:00Z",
    customer_id: "C1",
    note: "do not persist",
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
      { type: "INITIAL", amount_money: { amount: -30, currency: "CAD" } },
    ],
    card_details: { fingerprint: "secret", card: { last_4: "1111" } },
    receipt_url: "https://example.invalid/receipt",
    buyer_email_address: "x@example.invalid",
    billing_address: { address_line_1: "1 Main" },
  });
  assert.equal(sanitized?.processing_fee_amount, 30);
  const fees = sanitized?.processing_fee as Record<string, unknown>[];
  assert.equal(fees[0]?.type, "INITIAL");
  assert.deepEqual(fees[0]?.amount_money, { amount: -30, currency: "CAD" });
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
