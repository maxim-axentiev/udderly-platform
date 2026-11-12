import assert from "node:assert/strict";
import test from "node:test";
import {
  centsToDollars,
  customerObjectCount,
  dollarsToCents,
  filterStaffObjects,
  inventoryPhotoSrc,
  outstandingNamingCount,
  staffAttentionLabel,
  staffCanPublish,
  type InventoryObject,
} from "./inventory";

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

test("staff filters combine status, tier, and purchaser search", () => {
  const objects = [
    staffObject({
      id: "real",
      name: "Goat tower",
      priceCents: 25000,
      state: "available",
    }),
    staffObject({
      id: "named",
      name: "Campaign Test Object $100",
      priceCents: 10000,
      isTest: true,
      state: "claimed_named",
      submittedName: "Sir Bucketsworth III",
      purchaserEmail: "marketing@udderlyridiculous.ca",
      orderNumber: "390992680",
      attention: null,
    }),
    staffObject({
      id: "bucket",
      name: "Test Naming Bucket",
      priceCents: 2000,
      isTest: true,
      state: "claimed_named",
      submittedName: "Maxipad",
    }),
    staffObject({
      id: "reversed",
      name: "Refunded trough",
      priceCents: 10000,
      state: "claimed_named",
      submittedName: "Refunded name",
      attention: "payment_reversed",
      reviewReason: "payment_reversed",
    }),
  ];
  assert.equal(customerObjectCount(objects), 2);
  assert.equal(outstandingNamingCount(objects), 0);
  const namedHundred = filterStaffObjects(objects, {
    status: "claimed_named",
    tier: "10000",
    query: "marketing@udderlyridiculous.ca",
  });
  assert.deepEqual(namedHundred.map((object) => object.id), ["named"]);
  const byOrder = filterStaffObjects(objects, {
    status: "all",
    tier: "all",
    query: "390992680",
  });
  assert.deepEqual(byOrder.map((object) => object.id), ["named"]);
  assert.equal(
    staffAttentionLabel(objects[3].naming),
    "Payment reversed. This is not a normal paid claim.",
  );
});

function staffObject(input: {
  id: string;
  name: string;
  priceCents: number;
  state: InventoryObject["naming"]["state"];
  isTest?: boolean;
  submittedName?: string | null;
  purchaserEmail?: string | null;
  orderNumber?: string | null;
  attention?: InventoryObject["naming"]["attention"];
  reviewReason?: InventoryObject["naming"]["reviewReason"];
}): InventoryObject {
  return {
    id: input.id,
    name: input.name,
    description: "",
    photoUrl: null,
    priceCents: input.priceCents,
    currency: "CAD",
    availability:
      input.state === "available"
        ? "available"
        : input.state === "on_hold"
          ? "held"
          : "claimed",
    published: false,
    isTest: input.isTest === true,
    naming: {
      state: input.state,
      attention: input.attention ?? null,
      reviewReason: input.reviewReason ?? null,
      submittedName: input.submittedName ?? null,
      purchaserName: null,
      purchaserEmail: input.purchaserEmail ?? null,
      purchaserPhone: null,
      orderNumber: input.orderNumber ?? null,
      paidAmountCents: null,
      currency: null,
      purchasedAt: null,
    },
  };
}
