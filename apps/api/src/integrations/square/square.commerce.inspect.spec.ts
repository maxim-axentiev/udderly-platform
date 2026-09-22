import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSquareCommerceInspect,
  inspectSquareOrderSnapshots,
} from "./square.commerce.inspect";
import { sanitizeSquareOrder } from "./square.commerce.sanitize";

test("inspect aggregates return evidence without ids or names", () => {
  const sanitized = sanitizeSquareOrder({
    id: "SYN-SQ-INSPECT-ORDER",
    location_id: "L1",
    state: "COMPLETED",
    closed_at: "2026-08-28T16:00:00.000Z",
    net_amounts: {
      total_money: { amount: 0, currency: "CAD" },
      discount_money: { amount: -1375, currency: "CAD" },
    },
    return_amounts: {
      total_money: { amount: 0, currency: "CAD" },
      discount_money: { amount: 1375, currency: "CAD" },
    },
    returns: [
      {
        uid: "LEAKY-UID",
        source_order_id: "LEAKY-SOURCE-ORDER",
        name: "Do Not Print",
        return_line_items: [{ name: "Gouda" }, { name: "Milk" }],
        return_discounts: [{ name: "Staff" }],
      },
    ],
  });
  assert.ok(sanitized);
  const summary = inspectSquareOrderSnapshots(
    [sanitized],
    "2026-08-28 to 2026-08-28 (America/Toronto)",
  );
  assert.equal(summary.ordersWithReturns, 1);
  assert.equal(summary.returnObjectCount, 1);
  assert.equal(summary.returnLineItemCount, 2);
  assert.equal(summary.returnDiscountCount, 1);
  assert.equal(summary.returnsWithSourceOrderId, 1);
  assert.equal(summary.returnAmountsDiscount, 1375);
  assert.equal(summary.netAmountsDiscount, -1375);
  const report = formatSquareCommerceInspect(summary);
  assert.match(report, /Return discounts: 1/);
  assert.equal(report.includes("SYN-SQ-INSPECT-ORDER"), false);
  assert.equal(report.includes("LEAKY-UID"), false);
  assert.equal(report.includes("LEAKY-SOURCE-ORDER"), false);
  assert.equal(report.includes("Gouda"), false);
  assert.equal(report.includes("Do Not Print"), false);
  assert.equal(report.includes("@"), false);
});
