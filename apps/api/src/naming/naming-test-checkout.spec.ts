import assert from "node:assert/strict";
import test from "node:test";
import { validateEnv } from "../config/env";
import {
  GIFT_CARD_NAMING_ROUTE,
  customerCheckoutAllowed,
  giftcardNamingRouteAllowed,
  parseTestCheckoutObjectId,
  staffTestCheckoutAllowed,
  testNamingLinkAllowed,
} from "./naming-test-checkout";

const TEST_ID = "b7269f72-00f6-450e-95e4-95c76d708497";
const REAL_ID = "15898afd-b977-48b6-adb3-5a1eed602468";
const baseEnv = {
  DATABASE_URL: "postgresql://postgres:naming@127.0.0.1:55432/naming",
  REDIS_URL: "redis://127.0.0.1:6379",
};

test("an unset or malformed test-checkout id stays closed", () => {
  assert.equal(parseTestCheckoutObjectId(undefined), undefined);
  assert.equal(parseTestCheckoutObjectId(""), undefined);
  assert.equal(parseTestCheckoutObjectId("not-a-uuid"), undefined);
  assert.equal(parseTestCheckoutObjectId(TEST_ID.toUpperCase()), undefined);
  assert.equal(parseTestCheckoutObjectId(` ${TEST_ID} `), TEST_ID);
  assert.equal(validateEnv(baseEnv).NAMING_TEST_CHECKOUT_OBJECT_ID, undefined);
  assert.equal(
    validateEnv({ ...baseEnv, NAMING_TEST_CHECKOUT_OBJECT_ID: "nope" })
      .NAMING_TEST_CHECKOUT_OBJECT_ID,
    undefined,
  );
  assert.equal(
    validateEnv({ ...baseEnv, NAMING_TEST_CHECKOUT_OBJECT_ID: TEST_ID })
      .NAMING_TEST_CHECKOUT_OBJECT_ID,
    TEST_ID,
  );
});

test("staff test checkout accepts only the configured unpublished available test object", () => {
  const available = {
    id: TEST_ID,
    isTest: true,
    publishedAt: null,
    status: "available",
  };
  assert.equal(staffTestCheckoutAllowed(available, undefined), false);
  assert.equal(staffTestCheckoutAllowed(available, REAL_ID), false);
  assert.equal(staffTestCheckoutAllowed({ ...available, id: REAL_ID }, TEST_ID), false);
  assert.equal(
    staffTestCheckoutAllowed({ ...available, isTest: false }, TEST_ID),
    false,
  );
  assert.equal(
    staffTestCheckoutAllowed(
      { ...available, publishedAt: new Date("2026-11-11T00:00:00Z") },
      TEST_ID,
    ),
    false,
  );
  assert.equal(
    staffTestCheckoutAllowed({ ...available, status: "held" }, TEST_ID),
    false,
  );
  assert.equal(
    staffTestCheckoutAllowed({ ...available, status: "claimed" }, TEST_ID),
    false,
  );
  assert.equal(staffTestCheckoutAllowed(available, TEST_ID), true);
  assert.equal(
    customerCheckoutAllowed({ isTest: true, publishedAt: new Date() }),
    false,
  );
  assert.equal(
    customerCheckoutAllowed({ isTest: false, publishedAt: null }),
    false,
  );
  assert.equal(
    customerCheckoutAllowed({ isTest: false, publishedAt: new Date() }),
    true,
  );
});

test("the naming-link exception ignores host headers and other tokens", () => {
  assert.equal(giftcardNamingRouteAllowed(undefined), false);
  assert.equal(giftcardNamingRouteAllowed("giftcard"), true);
  assert.equal(giftcardNamingRouteAllowed(["giftcard"]), false);
  assert.equal(giftcardNamingRouteAllowed("goatbarn"), false);
  const allowed = {
    configuredObjectId: TEST_ID,
    route: GIFT_CARD_NAMING_ROUTE,
    objectId: TEST_ID,
    isTest: true,
  };
  assert.equal(testNamingLinkAllowed(allowed), true);
  assert.equal(testNamingLinkAllowed({ ...allowed, configuredObjectId: undefined }), false);
  assert.equal(testNamingLinkAllowed({ ...allowed, objectId: REAL_ID }), false);
  assert.equal(testNamingLinkAllowed({ ...allowed, isTest: false }), false);
  assert.equal(testNamingLinkAllowed({ ...allowed, route: undefined }), false);
  assert.equal(testNamingLinkAllowed({ ...allowed, route: "closed" }), false);
});
