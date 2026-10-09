import assert from "node:assert/strict";
import test from "node:test";
import {
  MAILCHIMP_APPROVED_ACCOUNT_TIME_ZONES,
  MAILCHIMP_REPORTING_TIME_ZONE,
} from "./mailchimp.constants";
import {
  assertMailchimpQuality,
  isApprovedMailchimpAccountTimeZone,
  qualityFailure,
} from "./mailchimp.quality";

test("approved America/Toronto and America/New_York account timezones pass", () => {
  assert.deepEqual([...MAILCHIMP_APPROVED_ACCOUNT_TIME_ZONES], [
    "America/Toronto",
    "America/New_York",
  ]);
  assert.equal(MAILCHIMP_REPORTING_TIME_ZONE, "America/Toronto");
  for (const timezone of MAILCHIMP_APPROVED_ACCOUNT_TIME_ZONES) {
    assert.equal(isApprovedMailchimpAccountTimeZone(timezone), true);
    assert.equal(qualityFailure({ timezone }), undefined);
    assertMailchimpQuality({ timezone });
  }
});

test("missing and empty timezones fail closed", () => {
  assert.equal(qualityFailure({}), "mailchimp_timezone_missing");
  assert.equal(qualityFailure({ timezone: "" }), "mailchimp_timezone_missing");
  assert.throws(() => assertMailchimpQuality({}), /mailchimp_timezone_missing/);
});

test("unknown and unsupported timezones fail closed", () => {
  for (const timezone of [
    "America/Chicago",
    "America/Los_Angeles",
    "UTC",
    "Europe/London",
    "EST",
    "America/Toronto ",
  ]) {
    assert.equal(isApprovedMailchimpAccountTimeZone(timezone), false);
    assert.equal(qualityFailure({ timezone }), "mailchimp_timezone_unsupported");
  }
});
