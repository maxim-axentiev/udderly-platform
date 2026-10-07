import assert from "node:assert/strict";
import test from "node:test";
import {
  GSC_CANONICAL_SITE_URL,
  GSC_DATA_STATE,
  GSC_SEARCH_TYPE,
} from "./google-search-console.constants";
import {
  GSC_METRICS,
  GSC_REPORT_DEFINITIONS,
  isGscReportFamilyId,
  reportDefinition,
} from "./google-search-console.reports";

test("defines exactly the six canonical families", () => {
  assert.deepEqual(
    GSC_REPORT_DEFINITIONS.map((item) => item.id),
    ["daily_totals", "query", "page", "country", "device", "search_appearance"],
  );
  assert.equal(GSC_REPORT_DEFINITIONS[0].id, "daily_totals");
});

test("date-grouped families include date; search appearance cannot", () => {
  for (const family of GSC_REPORT_DEFINITIONS) {
    assert.equal(isGscReportFamilyId(family.id), true);
    if (family.id === "search_appearance") {
      assert.equal(family.dimensions.includes("date"), false);
      continue;
    }
    assert.equal(family.dimensions[0], "date");
  }
  assert.equal(GSC_CANONICAL_SITE_URL.startsWith("sc-domain:"), true);
  assert.equal(GSC_CANONICAL_SITE_URL.includes("http"), false);
  assert.equal(GSC_DATA_STATE, "final");
  assert.equal(GSC_SEARCH_TYPE, "web");
  assert.deepEqual([...GSC_METRICS], ["clicks", "impressions", "ctr", "position"]);
});

test("search appearance uses searchAppearance without date", () => {
  assert.deepEqual(reportDefinition("search_appearance").dimensions, [
    "searchAppearance",
  ]);
});

test("unknown families fail closed", () => {
  assert.throws(() => reportDefinition("image"), /unknown_report_family/);
});
