import assert from "node:assert/strict";
import test from "node:test";

import { extractStaffBooking, presentStaffNaming } from "./naming-staff-booking";

const PURCHASED_AT = "2026-11-11T16:52:00-0500";

test("staff booking details keep the contact and drop card data", () => {
  const details = extractStaffBooking({
    booking: {
      pk: 390992680,
      display_id: "#390992680",
      confirmation_url: "https://fareharbor.example/secret",
      contact: {
        name: " Marketing Desk ",
        email: "marketing@udderlyridiculous.ca",
        phone: "",
        normalized_phone: "+1 555 0100",
        is_subscribed_for_email_updates: true,
      },
      payments: [
        {
          created_at: PURCHASED_AT,
          amount_paid: 10000,
          currency: "cad",
          card: { number: "4242424242424242", cvc: "123" },
        },
      ],
    },
  });
  assert.deepEqual(details, {
    purchaserName: "Marketing Desk",
    purchaserEmail: "marketing@udderlyridiculous.ca",
    purchaserPhone: "+1 555 0100",
    orderNumber: "390992680",
    purchasedAt: new Date("2026-11-11T21:52:00.000Z"),
  });
  assert.equal(JSON.stringify(details).includes("4242"), false);
  assert.equal(JSON.stringify(details).includes("confirmation_url"), false);
  assert.equal(extractStaffBooking({}), null);
});

test("a named paid claim stays distinct from a reversed claim", () => {
  const booking = extractStaffBooking({
    booking: {
      pk: 390992680,
      contact: { name: "Marketing", email: "marketing@udderlyridiculous.ca", phone: "555-0100" },
      payments: [{ created_at: PURCHASED_AT }],
    },
  });
  const paid = presentStaffNaming({
    objectStatus: "claimed",
    reservation: {
      status: "claimed",
      reviewReason: null,
      submittedName: "Sir Bucketsworth III",
      paidAmount: 10000,
      currency: "CAD",
      claimedAt: new Date("2026-11-11T21:52:18.271Z"),
    },
    booking,
  });
  assert.equal(paid.state, "claimed_named");
  assert.equal(paid.attention, null);
  assert.equal(paid.submittedName, "Sir Bucketsworth III");
  assert.equal(paid.orderNumber, "390992680");
  assert.equal(paid.paidAmountCents, 10000);
  assert.equal(paid.currency, "CAD");

  const reversed = presentStaffNaming({
    objectStatus: "claimed",
    reservation: {
      status: "claimed",
      reviewReason: "payment_reversed",
      submittedName: "Sir Bucketsworth III",
      paidAmount: 10000,
      currency: "CAD",
      claimedAt: new Date("2026-11-11T21:52:18.271Z"),
    },
    booking,
  });
  assert.equal(reversed.state, "claimed_named");
  assert.equal(reversed.attention, "payment_reversed");

  const unnamed = presentStaffNaming({
    objectStatus: "claimed",
    reservation: {
      status: "claimed",
      reviewReason: null,
      submittedName: null,
      paidAmount: 10000,
      currency: "CAD",
      claimedAt: new Date("2026-11-11T21:52:18.271Z"),
    },
    booking: null,
  });
  assert.equal(unnamed.state, "claimed_unnamed");
  assert.equal(unnamed.submittedName, null);
  assert.equal(unnamed.purchaserEmail, null);
});

test("holds and review reservations are not presented as paid claims", () => {
  const held = presentStaffNaming({
    objectStatus: "held",
    reservation: {
      status: "held",
      reviewReason: null,
      submittedName: null,
      paidAmount: null,
      currency: "CAD",
      claimedAt: null,
    },
    booking: {
      purchaserName: "Should not show",
      purchaserEmail: "hidden@example.invalid",
      purchaserPhone: null,
      orderNumber: "1",
      purchasedAt: null,
    },
  });
  assert.equal(held.state, "on_hold");
  assert.equal(held.attention, null);
  assert.equal(held.purchaserEmail, null);
  assert.equal(held.paidAmountCents, null);

  const review = presentStaffNaming({
    objectStatus: "held",
    reservation: {
      status: "needs_review",
      reviewReason: "underpaid",
      submittedName: null,
      paidAmount: 5000,
      currency: "CAD",
      claimedAt: null,
    },
    booking: {
      purchaserName: null,
      purchaserEmail: "buyer@example.invalid",
      purchaserPhone: null,
      orderNumber: "42",
      purchasedAt: new Date("2026-11-11T21:00:00.000Z"),
    },
  });
  assert.equal(review.state, "on_hold");
  assert.equal(review.attention, "review_required");
  assert.equal(review.reviewReason, "underpaid");
  assert.notEqual(review.state, "claimed_named");

  const available = presentStaffNaming({
    objectStatus: "available",
    reservation: null,
    booking: null,
  });
  assert.equal(available.state, "available");
  assert.equal(available.attention, null);

  const ambiguous = presentStaffNaming({
    objectStatus: "claimed",
    reservation: {
      status: "claimed",
      reviewReason: null,
      submittedName: "Wrong person",
      paidAmount: 10000,
      currency: "CAD",
      claimedAt: new Date(),
    },
    booking: {
      purchaserName: "Wrong",
      purchaserEmail: "wrong@example.invalid",
      purchaserPhone: null,
      orderNumber: "9",
      purchasedAt: null,
    },
    ambiguous: true,
  });
  assert.equal(ambiguous.state, "claimed_unnamed");
  assert.equal(ambiguous.attention, "review_required");
  assert.equal(ambiguous.submittedName, null);
  assert.equal(ambiguous.purchaserEmail, null);
});
