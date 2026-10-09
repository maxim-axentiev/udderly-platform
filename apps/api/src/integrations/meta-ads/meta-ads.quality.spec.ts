import assert from "node:assert/strict";
import test from "node:test";
import { qualityFailure } from "./meta-ads.quality";

test("pinned CAD Toronto 7d_click,1d_view passes", () => {
  assert.equal(
    qualityFailure({
      attributionWindow: "7d_click,1d_view",
      currency: "CAD",
      timezone: "America/Toronto",
    }),
    undefined,
  );
});

test("wrong attribution currency or timezone fail closed", () => {
  assert.equal(
    qualityFailure({ attributionWindow: "1d_click" }),
    "meta_ads_attribution_window_mismatch",
  );
  assert.equal(qualityFailure({ currency: "USD" }), "meta_ads_currency_not_cad");
  assert.equal(
    qualityFailure({ timezone: "America/Los_Angeles" }),
    "meta_ads_timezone_not_toronto",
  );
});
