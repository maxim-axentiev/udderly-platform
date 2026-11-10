import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignHome } from "./home-sections";
import { ObjectCatalog } from "./object-catalog";
import { previewObjects } from "./preview";

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
