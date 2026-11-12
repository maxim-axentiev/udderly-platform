import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignHome } from "./home-sections";
import { ObjectCatalog, interleaveByTier } from "./object-catalog";
import { filterByPrice } from "./format";
import { previewObjects } from "./preview";
import type { NamingObject } from "./api";

test("mobile tier filters stay in a two-column grid", () => {
  const html = renderToStaticMarkup(
    createElement(ObjectCatalog, {
      objects: previewObjects,
      purchasingEnabled: false,
      pendingId: null,
      onClaim: () => undefined,
    }),
  );
  assert.match(html, /grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-center/);
  assert.doesNotMatch(html, /overflow-x-auto/);
  assert.match(html, /col-span-2[\s\S]{0,80}All Objects/);
  for (const label of ["$100", "$250", "$500", "$1,000"]) {
    assert.match(html, new RegExp(label.replace("$", "\\$")));
  }
});

test("the campaign terms link has at least a 44px hit area", () => {
  const html = renderToStaticMarkup(
    createElement(CampaignHome, { catalog: null }),
  );
  assert.match(
    html,
    /inline-flex min-h-11 items-center[\s\S]{0,240}Read the full FAQs &amp; campaign terms/,
  );
});

test("a disabled preview card loads its protected photo and cannot purchase", () => {
  const photo =
    "/naming/preview/photos/11111111-1111-4111-8111-111111111111.jpg";
  const html = renderToStaticMarkup(
    createElement(ObjectCatalog, {
      objects: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Blue Bucket",
          description: "A real bucket",
          photoUrl: photo,
          priceCents: 10_000,
          currency: "CAD",
          availability: "available",
        },
      ],
      purchasingEnabled: false,
      pendingId: null,
      onClaim: () => {
        throw new Error("purchase");
      },
    }),
  );
  assert.match(html, new RegExp(`src="${photo}"`));
  assert.match(html, /disabled=""/);
  assert.equal(html.includes("fareharbor.com"), false);
});

test("the simplified landing page keeps the purchase note and drops the old sections", () => {
  const html = renderToStaticMarkup(
    createElement(CampaignHome, { catalog: null }),
  );
  assert.match(html, /src="\/campaign\/farm-sunset\.jpg"/);
  assert.match(html, /src="\/campaign\/highland-cows\.png"/);
  assert.match(html, /src="\/campaign\/goat-certificate\.png"/);
  assert.match(html, /Before you buy/);
  assert.match(html, /Promo ends December 31, 2026/);
  assert.match(html, /Names must be submitted by January 14, 2027/);
  assert.equal(html.includes("Not an animal. An actual object."), false);
  assert.equal(html.includes("The gift + the giggle"), false);
  assert.equal(html.includes("What you're buying"), false);
  assert.equal(html.includes("Six easy steps"), false);
  assert.equal(html.includes("Mark your calendar"), false);
  assert.equal(html.includes("Milestone"), false);
  assert.equal(html.includes("Gift Card Tiers"), false);
  assert.equal(html.includes("Some are useful"), false);
  assert.equal(html.includes("After it, no new naming-rights purchases"), false);
  assert.equal(html.includes("You don't have to wait"), false);
  assert.match(html, /Pick Your Thing/);
  assert.match(html, /Buy &amp; Claim/);
  assert.match(html, /Check Your Email/);
  assert.match(html, /Enjoy Your Farm Fame/);
  assert.match(html, /Giving the gift yourself/);
  assert.match(html, /grid-cols-1 gap-x-6 gap-y-10 md:grid-cols-2/);
  assert.equal(html.includes("Name Your Masterpiece"), false);
  assert.equal(html.includes("Get Your Certificate"), false);
  assert.equal(html.includes("Email 1"), false);
  assert.equal(html.includes("Buy Your Gift Card"), false);
});

test("claimed and on-hold cards share one grey treatment", () => {
  const html = renderToStaticMarkup(
    createElement(ObjectCatalog, {
      objects: [
        card("held", "held"),
        card("claimed", "claimed"),
      ],
      purchasingEnabled: true,
      pendingId: null,
      onClaim: () => undefined,
    }),
  );
  assert.equal(html.match(/grayscale/g)?.length, 2);
  assert.match(html, />On Hold</);
  assert.match(html, />Claimed</);
  assert.equal(html.includes("held-stripes"), false);
  assert.equal(html.includes("-rotate-12"), false);
});

test("the catalogue interleaves tiers in a stable order", () => {
  const objects = [
    ...tier("100", 2, 10_000),
    ...tier("250", 1, 25_000),
    ...tier("500", 1, 50_000),
    ...tier("1000", 2, 100_000),
  ];
  assert.deepEqual(
    interleaveByTier(objects).map((object) => object.priceCents),
    [100_000, 50_000, 25_000, 10_000, 100_000, 10_000],
  );
  assert.deepEqual(
    interleaveByTier(objects).map((object) => object.id),
    interleaveByTier(objects).map((object) => object.id),
  );
});
test("tier filters count the full catalogue", () => {
  const objects: NamingObject[] = [
    ...tier("100", 32, 10_000),
    ...tier("250", 32, 25_000),
    ...tier("500", 8, 50_000),
    ...tier("1000", 2, 100_000),
  ];
  assert.equal(objects.length, 74);
  assert.equal(filterByPrice(objects, 10_000).length, 32);
  assert.equal(filterByPrice(objects, 25_000).length, 32);
  assert.equal(filterByPrice(objects, 50_000).length, 8);
  assert.equal(filterByPrice(objects, 100_000).length, 2);
});

function card(id: string, availability: NamingObject["availability"]): NamingObject {
  return {
    id,
    name: id,
    description: "",
    photoUrl: null,
    priceCents: 10_000,
    currency: "CAD",
    availability,
  };
}

function tier(label: string, count: number, priceCents: number): NamingObject[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${label}-${index}`,
    name: `${label} ${index}`,
    description: "",
    photoUrl: null,
    priceCents,
    currency: "CAD",
    availability: "available" as const,
  }));
}
