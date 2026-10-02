import assert from "node:assert/strict";
import test from "node:test";
import {
  gaAdminExternalId,
  gaReportExternalId,
  gaScopedExternalId,
} from "./google-analytics.identity";

test("source identity keys are scoped by property, family, and range", () => {
  const site = gaReportExternalId("310874507", "daily_totals", "2023-03-01", "2023-03-07");
  const events = gaReportExternalId("310874507", "event", "2023-03-01", "2023-03-07");
  const otherWeek = gaReportExternalId("310874507", "daily_totals", "2023-03-08", "2023-03-14");
  const otherProperty = gaReportExternalId("999", "daily_totals", "2023-03-01", "2023-03-07");
  assert.notEqual(site, events);
  assert.notEqual(site, otherWeek);
  assert.notEqual(site, otherProperty);
  assert.equal(
    gaScopedExternalId("310874507", "email_address"),
    "310874507:email_address",
  );
  assert.notEqual(
    gaAdminExternalId("310874507"),
    gaScopedExternalId("310874507", "3445631200"),
  );
});
