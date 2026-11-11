import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignHome } from "./home-sections";
import { ObjectCatalog } from "./object-catalog";
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
