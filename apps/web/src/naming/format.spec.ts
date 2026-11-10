import assert from "node:assert/strict";
import test from "node:test";
import {
  availabilityLabel,
  CAMPAIGN_DEADLINE_NOTE,
  filterByPrice,
  formatCatalogPrice,
  formatPrice,
  holdRemainingLabel,
  isFareharborCheckoutUrl,
  priceChoices,
  reservationStatusText,
  safePhotoUrl,
} from "./format";
import { parseStoredCheckout } from "./checkout";

const checkoutUrl =
  "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/308290/?full-items=yes&flow=573099&ref=abc_def-123";

test("prices format as Canadian dollars and filter by exact cents", () => {
  assert.equal(formatPrice(2000, "CAD"), "$20.00");
  assert.equal(formatPrice(2500, "CAD"), "$25.00");
  assert.equal(formatCatalogPrice(10_000), "$100");
  assert.equal(formatCatalogPrice(100_000), "$1,000");
  assert.equal(formatCatalogPrice(2550), "$25.50");
  const objects = [
    { name: "Gate", priceCents: 5000 },
    { name: "Shed", priceCents: 2000 },
    { name: "Post", priceCents: 2000 },
  ];
  assert.deepEqual(priceChoices(objects), [2000, 5000]);
  assert.deepEqual(
    filterByPrice(objects, 2000).map((object) => object.name),
    ["Shed", "Post"],
  );
  assert.equal(filterByPrice(objects, null).length, 3);
});

test("customer deadline messages name the campaign dates", () => {
  assert.match(CAMPAIGN_DEADLINE_NOTE, /December 31, 2026/);
  assert.match(CAMPAIGN_DEADLINE_NOTE, /January 14, 2027/);
  assert.match(CAMPAIGN_DEADLINE_NOTE, /February 1, 2027/);
  assert.match(reservationStatusText("underpaid").detail, /gift card is valid/i);
  assert.match(reservationStatusText("underpaid").detail, /naming rights/);
  assert.match(reservationStatusText("purchase_closed").detail, /December 31, 2026/);
  assert.equal(reservationStatusText("underpaid").detail.includes("booking"), false);
});

test("availability labels stay explicit", () => {
  assert.equal(availabilityLabel("available"), "Available");
  assert.equal(availabilityLabel("held"), "On hold");
  assert.equal(availabilityLabel("claimed"), "Claimed");
});

test("photo urls accept only http addresses", () => {
  assert.equal(safePhotoUrl(null), null);
  assert.equal(safePhotoUrl("not a url"), null);
  assert.equal(safePhotoUrl("javascript:alert(1)"), null);
  assert.equal(
    safePhotoUrl("https://example.invalid/gate.jpg"),
    "https://example.invalid/gate.jpg",
  );
  assert.equal(
    safePhotoUrl("/photos/11111111-1111-4111-8111-111111111111.jpg"),
    "/photos/11111111-1111-4111-8111-111111111111.jpg",
  );
  assert.equal(safePhotoUrl("/photos/../secret.jpg"), null);
  assert.equal(safePhotoUrl("/photos/note.svg"), null);
  assert.equal(
    safePhotoUrl("/inventory/photos/11111111-1111-4111-8111-111111111111.webp"),
    "/inventory/photos/11111111-1111-4111-8111-111111111111.webp",
  );
});

test("checkout links must be the gift-card item with a reference", () => {
  assert.equal(isFareharborCheckoutUrl(checkoutUrl), true);
  assert.equal(isFareharborCheckoutUrl(`${checkoutUrl}&paid=true`), false);
  assert.equal(
    isFareharborCheckoutUrl("https://example.invalid/checkout"),
    false,
  );
  assert.equal(
    parseStoredCheckout(
      JSON.stringify({
        checkoutUrl,
        holdExpiresAt: "2026-11-03T15:30:00.000Z",
      }),
    )?.checkoutUrl,
    checkoutUrl,
  );
  assert.equal(
    parseStoredCheckout(
      JSON.stringify({
        checkoutUrl: "https://example.invalid/checkout",
        holdExpiresAt: "2026-11-03T15:30:00.000Z",
      }),
    ),
    null,
  );
  assert.equal(
    isFareharborCheckoutUrl(
      checkoutUrl.replace("full-items=yes&flow=573099", "flow=573099&full-items=yes"),
    ),
    false,
  );
  assert.equal(isFareharborCheckoutUrl(checkoutUrl, []), false);
  const tierUrl =
    "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/900250/?full-items=yes&flow=800250&ref=tier_ref-250";
  const allowList = [
    { itemId: "900100", flowId: "800100" },
    { itemId: "900250", flowId: "800250" },
  ];
  assert.equal(isFareharborCheckoutUrl(tierUrl), false);
  assert.equal(isFareharborCheckoutUrl(tierUrl, allowList), true);
  assert.equal(
    isFareharborCheckoutUrl(
      tierUrl.replace("flow=800250", "flow=800100"),
      allowList,
    ),
    false,
  );
  assert.equal(
    parseStoredCheckout(
      JSON.stringify({
        checkoutUrl: tierUrl,
        holdExpiresAt: "2026-11-03T15:30:00.000Z",
      }),
      allowList,
    )?.checkoutUrl,
    tierUrl,
  );
});

test("reservation copy does not treat checkout return as payment", () => {
  const awaiting = reservationStatusText("awaiting_payment");
  assert.match(awaiting.detail, /does not confirm payment/);
  assert.equal(reservationStatusText("paid").heading, "Payment recorded");
  assert.equal(reservationStatusText("expired").heading, "Hold ended");
  assert.equal(reservationStatusText("review").heading, "Payment under review");
  assert.match(reservationStatusText("named", "Buttercup").detail, /Buttercup/);
  const now = new Date("2026-11-03T15:00:00.000Z").getTime();
  assert.match(
    holdRemainingLabel("2026-11-03T15:30:00.000Z", now),
    /30 minutes/,
  );
  assert.match(holdRemainingLabel("2026-11-03T14:00:00.000Z", now), /passed/);
});
