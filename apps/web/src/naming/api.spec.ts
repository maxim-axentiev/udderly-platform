import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCatalog,
  parseCreatedReservation,
  parseNamingLink,
  parseReservation,
  resolveApiBaseUrl,
  NamingApiError,
} from "./api";

const objectId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const checkoutUrl =
  "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/308290/?full-items=yes&flow=573099&ref=abc_def-123";

test("production naming requests stay on the campaign site", () => {
  assert.equal(resolveApiBaseUrl(undefined, true), "");
  assert.equal(resolveApiBaseUrl("  ", true), "");
  assert.equal(resolveApiBaseUrl(undefined, false), "http://localhost:3001");
  assert.equal(
    resolveApiBaseUrl("https://giftcard.udderlyridiculousfarmlife.com/", true),
    "https://giftcard.udderlyridiculousfarmlife.com",
  );
});

test("catalog parsing keeps public fields and drops nothing required", () => {
  const objects = parseCatalog({
    objects: [
      {
        id: objectId,
        name: "Pasture gate",
        description: "The gate by the pasture",
        photoUrl: "https://example.invalid/gate.jpg",
        priceCents: 2500,
        currency: "CAD",
        availability: "available",
        checkoutRef: "secret-ref",
        namingTokenHash: "ab".repeat(32),
      },
    ],
  });
  assert.deepEqual(objects, [
    {
      id: objectId,
      name: "Pasture gate",
      description: "The gate by the pasture",
      photoUrl: "https://example.invalid/gate.jpg",
      priceCents: 2500,
      currency: "CAD",
      availability: "available",
    },
  ]);
  assert.equal(JSON.stringify(objects).includes("secret-ref"), false);
});

test("reservation creation requires the checkout url returned by the API", () => {
  const created = parseCreatedReservation({
    reservationId,
    holdExpiresAt: "2026-11-03T15:30:00.000Z",
    checkoutUrl,
  });
  assert.equal(created.reservationId, reservationId);
  assert.throws(
    () =>
      parseCreatedReservation({
        reservationId: "not-a-uuid",
        holdExpiresAt: "2026-11-03T15:30:00.000Z",
        checkoutUrl,
      }),
    NamingApiError,
  );
});

test("status and naming-link payloads reject missing public fields", () => {
  const status = parseReservation({
    reservationId,
    status: "awaiting_payment",
    holdExpiresAt: "2026-11-03T15:30:00.000Z",
    object: {
      id: objectId,
      name: "Pasture gate",
      description: "",
      photoUrl: null,
      priceCents: 2000,
      currency: "CAD",
    },
  });
  assert.equal(status.status, "awaiting_payment");
  assert.equal(parseReservation({ ...status, status: "review" }).status, "review");
  assert.throws(() => parseReservation({ ...status, status: "claimed" }), NamingApiError);

  const link = parseNamingLink({
    objectName: "Pasture gate",
    description: "The gate",
    photoUrl: null,
    namingStatus: "named",
    submittedName: "Buttercup",
    submissionOpen: true,
  });
  assert.equal(link.submittedName, "Buttercup");
  assert.throws(
    () => parseNamingLink({ ...link, submittedName: 12 }),
    NamingApiError,
  );
});
