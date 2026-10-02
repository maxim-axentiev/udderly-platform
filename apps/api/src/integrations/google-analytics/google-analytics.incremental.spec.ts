import assert from "node:assert/strict";
import test from "node:test";
import { FORBIDDEN_CUSTOM_DIMENSION_NAMES } from "./google-analytics.constants";
import type { GaImportWindowResult } from "./google-analytics-import.service";
import {
  formatGaIncrementalPlan,
  parseGaIncrementalArgs,
  planGaIncremental,
  runGaIncremental,
} from "./google-analytics.incremental";
import { GA_REPORT_DEFINITIONS, assertSafeDimensions } from "./google-analytics.reports";
import { assertNoSecrets } from "./google-analytics.sanitize";

const TORONTO = "America/Toronto";

function emptyImport(from: string, to: string, familyCount = 11): GaImportWindowResult {
  return {
    propertyId: "310874507",
    families: GA_REPORT_DEFINITIONS.slice(0, familyCount).map((definition) => ({
      family: definition.id,
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
    })),
    factsByFamily: {},
  };
}

test("plans yesterday, 3, 7, and 14 days ago as discrete dates", () => {
  const plan = planGaIncremental({
    dryRun: true,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  assert.deepEqual(plan.refreshDates, [
    "2026-09-18",
    "2026-09-25",
    "2026-09-29",
    "2026-10-01",
  ]);
  assert.equal(plan.refreshDates.includes("2026-10-02"), false);
  assert.equal(plan.families.length, 11);
  assert.equal(plan.skipped.length, 0);
});

test("orders refresh dates oldest-to-newest and deduplicates", () => {
  const plan = planGaIncremental({
    dryRun: false,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  assert.equal(plan.order, "oldest-to-newest");
  assert.equal(new Set(plan.refreshDates).size, plan.refreshDates.length);
  assert.deepEqual([...plan.refreshDates], [...plan.refreshDates].sort());
});

test("never includes the current farm day", () => {
  const now = new Date("2026-10-02T14:00:00Z");
  const plan = planGaIncremental({ dryRun: true, timeZone: TORONTO, now });
  assert.equal(plan.today, "2026-10-02");
  assert.equal(plan.refreshDates.includes(plan.today), false);
});

test("uses America/Toronto rather than the UTC calendar date", () => {
  const lateUtc = new Date("2026-10-03T02:30:00Z");
  const plan = planGaIncremental({ dryRun: true, timeZone: TORONTO, now: lateUtc });
  assert.equal(plan.today, "2026-10-02");
  assert.equal(plan.refreshDates.at(-1), "2026-10-01");
});

test("DST spring transition still uses civil Toronto dates", () => {
  const plan = planGaIncremental({
    dryRun: true,
    timeZone: TORONTO,
    now: new Date("2026-03-09T06:00:00Z"),
  });
  assert.equal(plan.today, "2026-03-09");
  assert.ok(plan.refreshDates.includes("2026-03-08"));
  assert.ok(plan.refreshDates.includes("2026-03-02"));
});

test("DST fall transition still uses civil Toronto dates", () => {
  const plan = planGaIncremental({
    dryRun: true,
    timeZone: TORONTO,
    now: new Date("2026-11-02T05:30:00Z"),
  });
  assert.equal(plan.today, "2026-11-02");
  assert.ok(plan.refreshDates.includes("2026-11-01"));
  assert.ok(plan.refreshDates.includes("2026-10-19"));
});

test("month, year, and leap-day boundaries", () => {
  assert.deepEqual(
    planGaIncremental({ dryRun: true, timeZone: TORONTO, asOf: "2026-03-01" }).refreshDates,
    ["2026-02-15", "2026-02-22", "2026-02-26", "2026-02-28"],
  );
  assert.deepEqual(
    planGaIncremental({ dryRun: true, timeZone: TORONTO, asOf: "2026-01-01" }).refreshDates,
    ["2025-12-18", "2025-12-25", "2025-12-29", "2025-12-31"],
  );
  assert.deepEqual(
    planGaIncremental({ dryRun: true, timeZone: TORONTO, asOf: "2024-03-01" }).refreshDates,
    ["2024-02-16", "2024-02-23", "2024-02-27", "2024-02-29"],
  );
});

test("skips dates before the earliest useful GA date", () => {
  const plan = planGaIncremental({
    dryRun: true,
    timeZone: TORONTO,
    asOf: "2022-04-16",
  });
  assert.deepEqual(plan.refreshDates, ["2022-04-13", "2022-04-15"]);
  assert.ok(plan.skipped.some((item) => item.date === "2022-04-09"));
  assert.ok(plan.skipped.every((item) => item.reason === "before_earliest_useful_date"));
});

test("rejects historical range flags so incremental cannot become a backfill", () => {
  assert.throws(
    () => parseGaIncrementalArgs(["--from", "2026-01-01", "--to", "2026-10-01"]),
    /ga_incremental_rejects_from_to_use_backfill/,
  );
  assert.throws(
    () => parseGaIncrementalArgs(["--as-of", "2026-10-02", "--chunk-days", "14"]),
    /ga_incremental_unknown_flag/,
  );
});

test("dry-run prints the plan with zero importer calls", async () => {
  const plan = parseGaIncrementalArgs(["--dry-run", "--as-of", "2026-10-02"]);
  let admin = 0;
  let imported = 0;
  const logs: string[] = [];
  const result = await runGaIncremental(
    {
      importAdminConfig: async () => {
        admin += 1;
        return { timezone: TORONTO };
      },
      importWindow: async () => {
        imported += 1;
        throw new Error("should_not_import");
      },
      reconcileWindow: () => {
        throw new Error("should_not_reconcile");
      },
    },
    plan,
    (line) => logs.push(line),
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(admin, 0);
  assert.equal(imported, 0);
  assert.ok(logs.some((line) => line.includes("today=2026-10-02")));
  assert.ok(logs.some((line) => line.includes("2026-09-18")));
  assert.ok(logs.some((line) => line.includes("families (11)")));
  assert.deepEqual(formatGaIncrementalPlan(plan).length >= 3, true);
});

test("successful run refreshes Admin once and all 11 families per date", async () => {
  const plan = planGaIncremental({
    dryRun: false,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  let admin = 0;
  const windows: string[] = [];
  const result = await runGaIncremental(
    {
      importAdminConfig: async () => {
        admin += 1;
        return { timezone: TORONTO };
      },
      importWindow: async (window) => {
        windows.push(`${window.from}/${window.to}`);
        assert.equal(window.from, window.to);
        return emptyImport(window.from, window.to, 11);
      },
      reconcileWindow: (imported) => ({
        passed: true,
        differences: [],
        diagnostics: [],
        totals: { rangeLabel: imported.propertyId, families: imported.families },
      }),
    },
    plan,
  );
  assert.equal(result.ok, true);
  assert.equal(admin, 1);
  assert.deepEqual(windows, [
    "2026-09-18/2026-09-18",
    "2026-09-25/2026-09-25",
    "2026-09-29/2026-09-29",
    "2026-10-01/2026-10-01",
  ]);
  assert.equal(result.completed, 4);
  if (result.ok) {
    assert.ok(result.reports.every((report) => report.families === 11));
  }
});

test("session diagnostic does not fail an incremental date", async () => {
  const plan = planGaIncremental({
    dryRun: false,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  const logs: string[] = [];
  const result = await runGaIncremental(
    {
      importWindow: async (window) => emptyImport(window.from, window.to),
      reconcileWindow: () => ({
        passed: true,
        differences: [],
        diagnostics: ["sessions diagnostic daily=170 acquisition=171 (not a gate)"],
        totals: { rangeLabel: "", families: [] },
      }),
    },
    plan,
    (line) => logs.push(line),
  );
  assert.equal(result.ok, true);
  assert.ok(logs.some((line) => line.includes("sessions diagnostic")));
});

test("idempotent rerun visits the same four dates and does not invent extra dates", async () => {
  const plan = planGaIncremental({
    dryRun: false,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  const seen: string[] = [];
  const deps = {
    importWindow: async (window: { from: string; to: string }) => {
      seen.push(window.from);
      return emptyImport(window.from, window.to);
    },
    reconcileWindow: () => ({
      passed: true,
      differences: [],
      diagnostics: [],
      totals: { rangeLabel: "", families: [] },
    }),
  };
  const first = await runGaIncremental(deps, plan);
  const second = await runGaIncremental(deps, plan);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(seen, [...plan.refreshDates, ...plan.refreshDates]);
});

test("fails closed on the first bad date and names it", async () => {
  const plan = planGaIncremental({
    dryRun: false,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  const result = await runGaIncremental(
    {
      importWindow: async (window) => {
        if (window.from === "2026-09-25") {
          throw new Error("google_analytics_sampled_report family=page_path");
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
  assert.equal(result.failedDate, "2026-09-25");
  assert.equal(result.completed, 1);
  assert.match(result.message, /sampled_report/);
  assert.match(result.message, /page_path/);
});

for (const [name, message] of [
  ["sampling", "google_analytics_sampled_report family=event"],
  ["thresholding", "google_analytics_provider_thresholded_data_suppressed family=country"],
  ["dataLossFromOtherRow", "google_analytics_data_loss_from_other_row family=page_path"],
  ["oauth", "invalid_grant"],
] as const) {
  test(`fails closed on ${name}`, async () => {
    const plan = planGaIncremental({
      dryRun: false,
      timeZone: TORONTO,
      asOf: "2026-10-02",
    });
    const result = await runGaIncremental(
      {
        importWindow: async () => {
          throw new Error(message);
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
    if (!result.ok) {
      assert.equal(result.failedDate, plan.refreshDates[0]);
      assert.equal(result.message, message);
    }
  });
}

test("fails closed on incomplete pagination, unresolved rows, and eventCount mismatch", async () => {
  const plan = planGaIncremental({
    dryRun: false,
    timeZone: TORONTO,
    asOf: "2026-10-02",
  });
  const cases = [
    {
      differences: ["page_path: rowCount 100 != source 50"],
    },
    {
      differences: ["event: unresolved 3"],
    },
    {
      differences: ["eventCount daily=10 event=11"],
    },
  ];
  for (const item of cases) {
    const result = await runGaIncremental({
      importWindow: async (window) => emptyImport(window.from, window.to),
      reconcileWindow: () => ({
        passed: false,
        differences: item.differences,
        diagnostics: [],
        totals: { rangeLabel: "", families: [] },
      }),
    }, plan);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failedDate, plan.refreshDates[0]);
      assert.equal(result.message, item.differences[0]);
    }
  }
});

test("privacy restrictions remain in force for incremental families", () => {
  for (const definition of GA_REPORT_DEFINITIONS) {
    assert.doesNotThrow(() => assertSafeDimensions(definition.dimensions));
  }
  for (const name of FORBIDDEN_CUSTOM_DIMENSION_NAMES) {
    assert.throws(() => assertSafeDimensions(["date", name]), /forbidden_dimension/);
  }
  assert.throws(
    () =>
      assertNoSecrets({
        refresh_token: "1//not-a-real-token",
      }),
    /snapshot_contains_secret/,
  );
});
