import assert from "node:assert/strict";
import test from "node:test";
import {
  TEST_CHECKOUT_ENABLED,
  countPublicCatalogObjects,
  isPublicCatalogObject,
  selectCustomerLaunchObjects,
  testObjectCheckoutAllowed,
} from "./naming-launch";

test("test objects stay out of public counts and launch publication", () => {
  const objects = [
    { id: "real", isTest: false, publishedAt: null, status: "available" },
    { id: "already", isTest: false, publishedAt: new Date("2026-11-16T00:00:00Z"), status: "available" },
    { id: "bucket", isTest: true, publishedAt: null, status: "claimed" },
    { id: "checkout", isTest: true, publishedAt: null, status: "available" },
    { id: "held", isTest: false, publishedAt: null, status: "held" },
  ];
  assert.deepEqual(
    selectCustomerLaunchObjects(objects).map((object) => object.id),
    ["real"],
  );
  assert.equal(countPublicCatalogObjects(objects), 1);
  assert.equal(isPublicCatalogObject(objects[1]), true);
  assert.equal(isPublicCatalogObject(objects[3]), false);
  assert.equal(TEST_CHECKOUT_ENABLED, false);
  assert.equal(testObjectCheckoutAllowed(objects[3]), false);
});
