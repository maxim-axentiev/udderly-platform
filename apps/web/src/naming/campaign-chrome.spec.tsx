import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignFrame } from "./campaign-chrome";

test("the naming page keeps the logo and removes navigation", () => {
  const html = renderToStaticMarkup(
    createElement(CampaignFrame, {
      navigation: false,
      children: "Name this object",
    }),
  );
  assert.match(html, /alt="Udderly Ridiculous Farm Life"/);
  assert.match(html, /src="\/campaign\/farm-logo\.png"/);
  assert.match(html, /Name this object/);
  assert.doesNotMatch(html, /<a[\s>]/);
  assert.doesNotMatch(html, /Browse the Things/);
  assert.doesNotMatch(html, /All objects/i);
  assert.match(html, /Name That Thing!/);
  assert.match(html, /processed through our checkout/);
  assert.equal(html.includes("FareHarbor"), false);
});
