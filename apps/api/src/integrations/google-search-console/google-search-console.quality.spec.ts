import assert from "node:assert/strict";
import test from "node:test";
import { qualityFailure } from "./google-search-console.quality";

test("final web reports pass", () => {
  assert.equal(qualityFailure({ dataState: "final", searchType: "web" }), undefined);
});

test("non-final and non-web reports fail closed", () => {
  assert.equal(
    qualityFailure({ dataState: "all", searchType: "web" }),
    "google_search_console_non_final_data",
  );
  assert.equal(
    qualityFailure({ dataState: "final", searchType: "image" }),
    "google_search_console_non_web_search_type",
  );
});
