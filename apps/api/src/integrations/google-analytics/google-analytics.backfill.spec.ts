import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGaBackfillArgs,
  planGaBackfill,
  runGaBackfill,
} from "./google-analytics.backfill";
import type { GaImportWindowResult } from "./google-analytics-import.service";

const NOW = new Date("2026-03-15T15:00:00Z");

test("requires exact --from and --to and rejects pre-property dates", () => {
  assert.throws(() => parseGaBackfillArgs(["--from", "2022-04-01"], { now: NOW }), /ga_backfill_requires_from_to/);
  assert.throws(
    () =>
      planGaBackfill({
        from: "2022-04-12",
        to: "2022-04-13",
        dryRun: true,
        timeZone: "America/Toronto",
        now: NOW,
      }),
    /ga_range_before_earliest_useful_date/,
  );
  const plan = planGaBackfill({
    from: "2022-04-13",
    to: "2022-04-20",
    dryRun: true,
    timeZone: "America/Toronto",
    now: NOW,
  });
  assert.equal(plan.from, "2022-04-13");
  assert.equal(plan.order, "oldest-to-newest");
  assert.deepEqual(plan.chunks[0], { from: "2022-04-13", to: "2022-04-19" });
});

test("dry-run prints the chunk plan without importing", async () => {
  const plan = parseGaBackfillArgs(
    ["--from", "2023-03-01", "--to", "2023-03-10", "--dry-run"],
    { now: NOW },
  );
  let imported = 0;
  const logs: string[] = [];
  const result = await runGaBackfill(
    {
      importWindow: async () => {
        imported += 1;
        throw new Error("should_not_import");
      },
      reconcileWindow: () => ({
        passed: true,
        differences: [],
        diagnostics: [],
        totals: { rangeLabel: "", families: [] },
      }),
    },
    plan,
    (message) => logs.push(message),
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(imported, 0);
  assert.ok(logs.some((line) => line.includes("dry-run chunk")));
});

test("dry-run does not import admin config or mutate", async () => {
  const plan = parseGaBackfillArgs(
    ["--from", "2023-03-01", "--to", "2023-03-10", "--dry-run"],
    { now: NOW },
  );
  let admin = 0;
  const result = await runGaBackfill(
    {
      importAdminConfig: async () => {
        admin += 1;
        return { timezone: "America/Toronto" };
      },
      importWindow: async () => {
        throw new Error("should_not_import");
      },
      reconcileWindow: () => ({
        passed: true,
        differences: [],
        diagnostics: [],
        totals: { rangeLabel: "", families: [] },
      }),
    },
    plan,
  );
  assert.equal(result.ok, true);
  assert.equal(admin, 0);
});

test("stops on the first failed chunk and is restartable from remaining ranges", async () => {
  const plan = planGaBackfill({
    from: "2023-03-01",
    to: "2023-03-14",
    dryRun: false,
    timeZone: "America/Toronto",
    now: NOW,
  });
  assert.ok(plan.chunks.length >= 2);
  let calls = 0;
  const result = await runGaBackfill(
    {
      importWindow: async (window) => {
        calls += 1;
        if (window.from === plan.chunks[1].from) {
          throw new Error("chunk_failed");
        }
        return emptyImport(window.from, window.to);
      },
      reconcileWindow: () => ({
        passed: true,
        differences: [],
        diagnostics: [],
        totals: { rangeLabel: "", families: [] },
      }),
    },
    plan,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected failure");
  }
  assert.equal(result.completed, 1);
  assert.deepEqual(result.failedChunk, plan.chunks[1]);
  assert.equal(calls, 2);

  const remaining = planGaBackfill({
    from: plan.chunks[1].from,
    to: plan.to,
    dryRun: false,
    timeZone: "America/Toronto",
    now: NOW,
  });
  assert.equal(remaining.chunks[0].from, plan.chunks[1].from);
});

test("idempotent rerun of a passing chunk is allowed", async () => {
  const plan = planGaBackfill({
    from: "2023-03-01",
    to: "2023-03-03",
    dryRun: false,
    timeZone: "America/Toronto",
    now: NOW,
  });
  const deps = {
    importWindow: async (window: { from: string; to: string }) =>
      emptyImport(window.from, window.to),
    reconcileWindow: () => ({
      passed: true,
      differences: [],
      diagnostics: [],
      totals: { rangeLabel: "", families: [] },
    }),
  };
  const first = await runGaBackfill(deps, plan);
  const second = await runGaBackfill(deps, plan);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.completed, second.completed);
});

test("session diagnostic does not fail a backfill chunk", async () => {
  const plan = planGaBackfill({
    from: "2023-04-04",
    to: "2023-04-04",
    dryRun: false,
    timeZone: "America/Toronto",
    now: NOW,
  });
  const logs: string[] = [];
  const result = await runGaBackfill(
    {
      importWindow: async (window) => emptyImport(window.from, window.to),
      reconcileWindow: () => ({
        passed: true,
        differences: [],
        diagnostics: [
          "sessions diagnostic daily=170 acquisition=171 (not a gate)",
        ],
        totals: { rangeLabel: "2023-04-04", families: [] },
      }),
    },
    plan,
    (message) => logs.push(message),
  );
  assert.equal(result.ok, true);
  assert.ok(logs.some((line) => line.includes("PASS")));
  assert.ok(logs.some((line) => line.includes("sessions diagnostic daily=170")));
});

function emptyImport(from: string, to: string): GaImportWindowResult {
  return {
    propertyId: "310874507",
    families: [
      {
        family: "daily_totals",
        startDate: from,
        endDate: to,
        sourceRows: 0,
        providerRowCount: 0,
        canonicalRows: 0,
        unresolvedRows: 0,
        requestCount: 1,
        sampled: false,
        dataLossFromOtherRow: false,
        subjectToThresholding: false,
      },
    ],
    factsByFamily: {},
  };
}
