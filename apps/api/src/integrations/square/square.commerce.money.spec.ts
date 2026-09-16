import assert from "node:assert/strict";
import test from "node:test";
import { netProcessingFeeCost } from "./square.commerce.money";

function fee(
  amount: number,
  type: string,
): Record<string, unknown> {
  return {
    type,
    amount_money: { amount, currency: "CAD" },
  };
}

test("A. one normal INITIAL fee is the nonnegative cost", () => {
  assert.deepEqual(netProcessingFeeCost([fee(-30, "INITIAL")]), {
    status: "cost",
    amount: 30,
  });
});

test("B. multiple fee components net together", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(-20, "INITIAL"), fee(-10, "INITIAL")]),
    { status: "cost", amount: 30 },
  );
});

test("C. fee plus partial reversal is the net cost, not abs-sum", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(-30, "INITIAL"), fee(10, "ADJUSTMENT")]),
    { status: "cost", amount: 20 },
  );
});

test("D. fee fully reversed is zero cost", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(-30, "INITIAL"), fee(30, "ADJUSTMENT")]),
    { status: "cost", amount: 0 },
  );
});

test("E. no processing fee is none", () => {
  assert.deepEqual(netProcessingFeeCost(undefined), { status: "none" });
  assert.deepEqual(netProcessingFeeCost([]), { status: "none" });
});

test("net credit is reported, not clamped to a fake zero cost", () => {
  assert.deepEqual(
    netProcessingFeeCost([fee(15, "ADJUSTMENT")]),
    { status: "invalid_net_credit", netSigned: 15 },
  );
});
