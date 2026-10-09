import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMailchimpImportPlan,
  parseMailchimpImportArgs,
} from "./mailchimp.import-plan";
import { MOCK_MAILCHIMP_API_KEY } from "./mailchimp.fixtures";

const NOW = new Date("2026-10-06T20:00:00Z");

test("import dry-run is planning-only", () => {
  const plan = parseMailchimpImportArgs(
    ["--from", "2026-09-30", "--to", "2026-10-04", "--dry-run"],
    { now: NOW },
  );
  assert.equal(plan.dryRun, true);
  const lines = formatMailchimpImportPlan(plan);
  assert.ok(lines.some((line) => line.includes("no Nest boot")));
  assert.ok(lines.some((line) => line.includes("possibly unpublished")));
  assert.ok(lines.some((line) => line.includes("forbidden")));
  assert.ok(!lines.some((line) => line.includes(MOCK_MAILCHIMP_API_KEY)));
});

test("account-only dry-run does not require a range", () => {
  const plan = parseMailchimpImportArgs(["--account-only", "--dry-run"], { now: NOW });
  assert.equal(plan.accountOnly, true);
  assert.equal(plan.from, undefined);
});

test("live import still rejects current Toronto day", () => {
  assert.throws(
    () =>
      parseMailchimpImportArgs(["--from", "2026-09-30", "--to", "2026-10-06"], {
        now: NOW,
      }),
    /mailchimp_range_includes_current_or_future_day/,
  );
});
