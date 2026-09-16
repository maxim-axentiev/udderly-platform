import assert from "node:assert/strict";
import test from "node:test";
import { orderLineExternalId } from "./square.commerce.line";

test("uid identity does not include position", () => {
  assert.equal(
    orderLineExternalId({
      orderId: "O1",
      version: 2,
      uid: "U1",
      index: 9,
    }),
    "O1:U1",
  );
});

test("no-uid identity is scoped to order version", () => {
  assert.equal(
    orderLineExternalId({
      orderId: "O1",
      version: 1,
      uid: undefined,
      index: 0,
    }),
    "O1:version:1:pos:0",
  );
  assert.equal(
    orderLineExternalId({
      orderId: "O1",
      version: 2,
      uid: undefined,
      index: 0,
    }),
    "O1:version:2:pos:0",
  );
});
