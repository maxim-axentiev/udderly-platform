import assert from "node:assert/strict";
import test from "node:test";
import { centsToDollars, dollarsToCents, inventoryPhotoSrc, staffCanPublish } from "./inventory";

test("staff prices use CAD cents and reject extra fractions", () => {
  assert.equal(dollarsToCents("20"), 2000);
  assert.equal(dollarsToCents("20.5"), 2050);
  assert.equal(dollarsToCents("20.00"), 2000);
  assert.equal(dollarsToCents("20.50"), 2050);
  assert.equal(dollarsToCents("0.01"), 1);
  assert.equal(dollarsToCents("20.555"), undefined);
  assert.equal(dollarsToCents("20.5.0"), undefined);
  assert.equal(dollarsToCents(""), undefined);
  assert.equal(centsToDollars(2000), "20.00");
  assert.equal(centsToDollars(2050), "20.50");
  assert.equal(
    inventoryPhotoSrc("/photos/11111111-1111-4111-8111-111111111111.jpg"),
    "/inventory/photos/11111111-1111-4111-8111-111111111111.jpg",
  );
  assert.equal(inventoryPhotoSrc("/photos/../secret.jpg"), null);
  assert.equal(
    inventoryPhotoSrc("https://example.invalid/gate.jpg"),
    "https://example.invalid/gate.jpg",
  );
  assert.equal(
    staffCanPublish({ isTest: false, availability: "available", published: false }),
    true,
  );
  assert.equal(
    staffCanPublish({ isTest: true, availability: "available", published: false }),
    false,
  );
});
