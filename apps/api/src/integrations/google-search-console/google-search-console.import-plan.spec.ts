import assert from "node:assert/strict";
import test from "node:test";
import {
  formatGscImportPlan,
  parseGscImportArgs,
} from "./google-search-console.import-plan";

const NOW = new Date("2026-10-06T20:00:00Z");

test("import dry-run is planning-only", () => {
  const plan = parseGscImportArgs(
    ["--from", "2026-09-30", "--to", "2026-10-04", "--dry-run"],
    { now: NOW },
  );
  assert.equal(plan.dryRun, true);
  const lines = formatGscImportPlan(plan);
  assert.ok(lines.some((line) => line.includes("no Nest boot")));
  assert.ok(lines.some((line) => line.includes("possibly unpublished")));
});

test("site-only dry-run does not require a range", () => {
  const plan = parseGscImportArgs(["--site-only", "--dry-run"], { now: NOW });
  assert.equal(plan.siteOnly, true);
  assert.equal(plan.from, undefined);
});

test("live import still rejects current Pacific day", () => {
  assert.throws(
    () =>
      parseGscImportArgs(["--from", "2026-09-30", "--to", "2026-10-06"], { now: NOW }),
    /gsc_range_includes_current_or_future_day/,
  );
});
