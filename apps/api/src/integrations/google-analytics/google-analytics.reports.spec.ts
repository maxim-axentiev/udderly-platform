import assert from "node:assert/strict";
import test from "node:test";
import { FORBIDDEN_CUSTOM_DIMENSION_NAMES } from "./google-analytics.constants";
import {
  ADDITIVE_DAILY_METRICS,
  GA_REPORT_DEFINITIONS,
  assertSafeDimensions,
  isForbiddenDimension,
  reportDefinition,
} from "./google-analytics.reports";

test("every permanent family uses exact allowlisted dimensions", () => {
  for (const definition of GA_REPORT_DEFINITIONS) {
    assert.doesNotThrow(() => assertSafeDimensions(definition.dimensions));
    assert.deepEqual(reportDefinition(definition.id).dimensions, definition.dimensions);
    assert.ok(definition.dimensions.includes("date"));
  }
  assert.deepEqual(reportDefinition("daily_totals").dimensions, ["date"]);
  assert.deepEqual(reportDefinition("session_acquisition").dimensions, [
    "date",
    "sessionSource",
    "sessionMedium",
    "sessionDefaultChannelGroup",
  ]);
  assert.deepEqual(reportDefinition("first_user_acquisition").dimensions, [
    "date",
    "firstUserSource",
    "firstUserMedium",
    "firstUserDefaultChannelGroup",
  ]);
  assert.deepEqual(reportDefinition("landing_page").dimensions, ["date", "landingPage"]);
  assert.deepEqual(reportDefinition("page_path").dimensions, ["date", "pagePath"]);
  assert.deepEqual(reportDefinition("event").dimensions, ["date", "eventName"]);
  assert.deepEqual(reportDefinition("country").dimensions, ["date", "country"]);
  assert.deepEqual(reportDefinition("device").dimensions, ["date", "deviceCategory"]);
  assert.deepEqual(reportDefinition("ecommerce_item").dimensions, ["date", "itemId"]);
});

test("forbidden custom dimensions cannot be requested", () => {
  for (const name of FORBIDDEN_CUSTOM_DIMENSION_NAMES) {
    assert.equal(isForbiddenDimension(name), true);
    assert.throws(() => assertSafeDimensions(["date", name]), /forbidden_dimension/);
  }
  assert.throws(() => reportDefinition("ads_campaign"), /unknown_report_family/);
});

test("compatibility splits keep daily totals at or below ten metrics", () => {
  assert.ok(reportDefinition("daily_totals").metrics.length <= 10);
  assert.ok(reportDefinition("daily_engagement").metrics.length <= 10);
  assert.ok(reportDefinition("ecommerce_totals").metrics.length <= 10);
});

test("fail-closed additive recon is eventCount only", () => {
  assert.deepEqual([...ADDITIVE_DAILY_METRICS], ["eventCount"]);
});
