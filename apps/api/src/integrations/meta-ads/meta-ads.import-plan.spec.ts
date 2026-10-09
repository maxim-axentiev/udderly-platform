import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMetaAdsImportPlan,
  parseMetaAdsImportArgs,
} from "./meta-ads.import-plan";

const NOW = new Date("2026-10-06T20:00:00Z");

test("import dry-run is planning-only", () => {
  const plan = parseMetaAdsImportArgs(
    ["--from", "2026-09-30", "--to", "2026-10-04", "--dry-run"],
    { now: NOW },
  );
  assert.equal(plan.dryRun, true);
  const lines = formatMetaAdsImportPlan(plan);
  assert.ok(lines.some((line) => line.includes("no Nest boot")));
  assert.ok(lines.some((line) => line.includes("possibly unpublished")));
  assert.ok(!lines.some((line) => /EAAG|access_token/i.test(line)));
});

test("account-only dry-run does not require a range", () => {
  const plan = parseMetaAdsImportArgs(["--account-only", "--dry-run"], { now: NOW });
  assert.equal(plan.accountOnly, true);
  assert.equal(plan.from, undefined);
});

test("live import still rejects current Toronto day", () => {
  assert.throws(
    () =>
      parseMetaAdsImportArgs(["--from", "2026-09-30", "--to", "2026-10-06"], {
        now: NOW,
      }),
    /meta_ads_range_includes_current_or_future_day/,
  );
});
