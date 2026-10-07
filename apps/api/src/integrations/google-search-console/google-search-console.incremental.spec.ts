import assert from "node:assert/strict";
import test from "node:test";
import type { GscImportWindowResult } from "./google-search-console-import.service";
import {
  GSC_INCREMENTAL_LOCK_NAME,
  GSC_REPORTING_TIME_ZONE,
} from "./google-search-console.constants";
import {
  formatGscIncrementalPlan,
  parseGscIncrementalArgs,
  planGscIncremental,
  runGscIncremental,
} from "./google-search-console.incremental";
import { GSC_REPORT_DEFINITIONS } from "./google-search-console.reports";

function emptyImport(date: string, published: boolean): GscImportWindowResult {
  return {
    siteUrl: "sc-domain:udderlyridiculousfarmlife.com",
    families: GSC_REPORT_DEFINITIONS.map((definition) => ({
      family: definition.id,
      startDate: date,
      endDate: date,
      sourceRows: published ? 1 : 0,
      providerRowCount: published ? 1 : 0,
      canonicalRows: published ? 1 : 0,
      unresolvedRows: 0,
      requestCount: 1,
      dataState: "final",
      searchType: "web",
    })),
    factsByFamily: {},
    publishedDates: published ? [date] : [],
    possiblyUnpublishedDates: published ? [] : [date],
    replacedDates: published ? [date] : [],
  };
}

test("plans offsets 2, 3, 7, and 14 oldest to newest", () => {
  const plan = planGscIncremental({
    dryRun: true,
    timeZone: GSC_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  assert.deepEqual(plan.refreshDates, [
    "2026-10-06",
    "2026-10-13",
    "2026-10-17",
    "2026-10-18",
  ]);
  assert.equal(plan.refreshDates.includes("2026-10-19"), false);
  assert.equal(plan.refreshDates.includes("2026-10-20"), false);
  assert.equal(plan.families.length, 6);
  assert.equal(GSC_INCREMENTAL_LOCK_NAME, "google-search-console-incremental");
});

test("offsets that fall before 2026-09-30 are skipped rather than requested", () => {
  const plan = planGscIncremental({
    dryRun: true,
    timeZone: GSC_REPORTING_TIME_ZONE,
    asOf: "2026-10-06",
  });
  assert.deepEqual(plan.refreshDates, ["2026-10-03", "2026-10-04"]);
  assert.ok(plan.skipped.some((item) => item.date === "2026-09-29"));
  assert.ok(plan.skipped.some((item) => item.date === "2026-09-22"));
});

test("uses the Search Console reporting calendar rather than Toronto", () => {
  const lateUtc = new Date("2026-10-07T06:30:00Z");
  const plan = planGscIncremental({
    dryRun: true,
    timeZone: GSC_REPORTING_TIME_ZONE,
    now: lateUtc,
  });
  assert.equal(plan.today, "2026-10-06");
});

test("skips dates before 2026-09-30", () => {
  const plan = planGscIncremental({
    dryRun: true,
    timeZone: GSC_REPORTING_TIME_ZONE,
    asOf: "2026-10-01",
  });
  assert.ok(plan.skipped.some((item) => item.reason === "before_earliest_useful_date"));
  assert.ok(plan.refreshDates.every((date) => date >= "2026-09-30"));
});

test("rejects historical range flags", () => {
  assert.throws(
    () => parseGscIncrementalArgs(["--from", "2026-09-30", "--to", "2026-10-01"]),
    /gsc_incremental_rejects_from_to_use_backfill/,
  );
});

test("dry-run prints the plan with zero importer calls", async () => {
  const plan = parseGscIncrementalArgs(["--dry-run", "--as-of", "2026-10-06"]);
  let site = 0;
  let imported = 0;
  const logs: string[] = [];
  const result = await runGscIncremental(
    {
      importSiteConfig: async () => {
        site += 1;
        return { siteUrl: "nope" };
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
  assert.equal(site, 0);
  assert.equal(imported, 0);
  assert.ok(logs.some((line) => line.includes("today=2026-10-06")));
  assert.ok(formatGscIncrementalPlan(plan).length >= 3);
});

test("unpublished offset 2 is a PASS skip, not a wipe failure", async () => {
  const plan = planGscIncremental({
    dryRun: false,
    timeZone: GSC_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const replaced: string[] = [];
  const result = await runGscIncremental({
    importWindow: async (window) => {
      const published = window.from !== "2026-10-18";
      if (published) {
        replaced.push(window.from);
      }
      return emptyImport(window.from, published);
    },
    reconcileWindow: (imported) => ({
      passed: true,
      differences: [],
      diagnostics: imported.possiblyUnpublishedDates.map(
        (date) => `possibly unpublished final date=${date} (not a gate)`,
      ),
      totals: {
        rangeLabel: "",
        families: imported.families,
        publishedDates: imported.publishedDates,
        possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
      },
    }),
  }, plan);
  assert.equal(result.ok, true);
  assert.equal(result.completed, 4);
  assert.equal(replaced.includes("2026-10-18"), false);
  assert.ok(result.reports.some((item) => item.date === "2026-10-18" && item.published === false));
});
