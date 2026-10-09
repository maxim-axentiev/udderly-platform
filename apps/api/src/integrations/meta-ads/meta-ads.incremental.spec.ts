import assert from "node:assert/strict";
import test from "node:test";
import type { MetaAdsImportWindowResult } from "./meta-ads-import.service";
import {
  META_ADS_IMPORT_LOCK_NAME,
  META_ADS_INCREMENTAL_DAY_OFFSETS,
  META_ADS_REPORTING_TIME_ZONE,
} from "./meta-ads.constants";
import {
  formatMetaAdsIncrementalPlan,
  parseMetaAdsIncrementalArgs,
  planMetaAdsIncremental,
  runMetaAdsIncremental,
} from "./meta-ads.incremental";
import { formatMetaAdsLockError } from "./meta-ads.lock";
import { META_ADS_INSIGHT_LEVELS } from "./meta-ads.reports";

function emptyImport(date: string, published: boolean): MetaAdsImportWindowResult {
  return {
    accountId: "act_1818645281666685",
    levels: META_ADS_INSIGHT_LEVELS.map((level) => ({
      level,
      startDate: date,
      endDate: date,
      sourceRows: published ? 1 : 0,
      providerRowCount: published ? 1 : 0,
      canonicalRows: published ? 1 : 0,
      unresolvedRows: 0,
      requestCount: 1,
      attributionWindow: "7d_click,1d_view",
    })),
    factsByLevel: {},
    publishedDates: published ? [date] : [],
    possiblyUnpublishedDates: published ? [] : [date],
    replacedDates: published ? [date] : [],
    replacedDatesByLevel: published
      ? Object.fromEntries(META_ADS_INSIGHT_LEVELS.map((level) => [level, [date]]))
      : {},
  };
}

const passVerdict = (imported: MetaAdsImportWindowResult) => ({
  passed: true as const,
  differences: [],
  diagnostics: imported.possiblyUnpublishedDates.map(
    (date) => `possibly unpublished insights date=${date} (not a gate; existing canonical grains were not replaced)`,
  ),
  totals: {
    rangeLabel: "",
    levels: imported.levels,
    publishedDates: imported.publishedDates,
    possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
  },
});

test("plans explicit Toronto offsets 1, 2, 3, 7, 14, and 28 oldest to newest", () => {
  const plan = planMetaAdsIncremental({
    dryRun: true,
    timeZone: META_ADS_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  assert.deepEqual([...META_ADS_INCREMENTAL_DAY_OFFSETS], [1, 2, 3, 7, 14, 28]);
  assert.deepEqual(plan.refreshDates, [
    "2026-09-22",
    "2026-10-06",
    "2026-10-13",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
  ]);
  assert.equal(plan.refreshDates.includes("2026-10-20"), false);
  assert.equal(plan.levels.length, 4);
  assert.equal(plan.timeZone, "America/Toronto");
  assert.equal(META_ADS_IMPORT_LOCK_NAME, "meta-ads-import");
});

test("uses America/Toronto rather than Pacific or UTC", () => {
  const lateUtc = new Date("2026-10-07T06:30:00Z");
  const plan = planMetaAdsIncremental({
    dryRun: true,
    timeZone: META_ADS_REPORTING_TIME_ZONE,
    now: lateUtc,
  });
  assert.equal(plan.today, "2026-10-07");
  assert.equal(plan.refreshDates.at(-1), "2026-10-06");
});

test("rejects historical range flags so incremental cannot become a backfill", () => {
  assert.throws(
    () => parseMetaAdsIncrementalArgs(["--from", "2026-09-30", "--to", "2026-10-01"]),
    /meta_ads_incremental_rejects_from_to_use_import/,
  );
});

test("dry-run prints the plan with zero importer calls", async () => {
  const plan = parseMetaAdsIncrementalArgs(["--dry-run", "--as-of", "2026-10-20"]);
  let account = 0;
  let imported = 0;
  const logs: string[] = [];
  const result = await runMetaAdsIncremental(
    {
      importAccountGraph: async () => {
        account += 1;
        return { accountId: "nope" };
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
  assert.equal(account, 0);
  assert.equal(imported, 0);
  assert.ok(logs.some((line) => line.includes("today=2026-10-20")));
  assert.ok(logs.some((line) => line.includes("2026-10-19")));
  assert.ok(formatMetaAdsIncrementalPlan(plan).some((line) => line.includes("no Nest boot")));
});

test("unpublished offset is a PASS skip, not a wipe", async () => {
  const plan = planMetaAdsIncremental({
    dryRun: false,
    timeZone: META_ADS_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const replaced: string[] = [];
  const result = await runMetaAdsIncremental({
    importWindow: async (window) => {
      const published = window.from !== "2026-10-19";
      if (published) {
        replaced.push(window.from);
      }
      return emptyImport(window.from, published);
    },
    reconcileWindow: passVerdict,
  }, plan);
  assert.equal(result.ok, true);
  assert.equal(result.completed, 6);
  assert.equal(replaced.includes("2026-10-19"), false);
  assert.ok(result.reports.some((item) => item.date === "2026-10-19" && item.published === false));
});

test("incomplete coverage at one level does not mark later dates as imported after a fetch failure", async () => {
  const plan = planMetaAdsIncremental({
    dryRun: false,
    timeZone: META_ADS_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const seen: string[] = [];
  const result = await runMetaAdsIncremental(
    {
      importWindow: async (window) => {
        seen.push(window.from);
        if (window.from === "2026-10-06") {
          throw new Error("Meta Ads /act_1818645281666685/insights failed with HTTP 500");
        }
        return emptyImport(window.from, true);
      },
      reconcileWindow: passVerdict,
    },
    plan,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedDate, "2026-10-06");
  assert.deepEqual(seen, ["2026-09-22", "2026-10-06"]);
  assert.equal(result.completed, 1);
});

test("idempotent rerun visits the same explicit dates", async () => {
  const plan = planMetaAdsIncremental({
    dryRun: false,
    timeZone: META_ADS_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const seen: string[] = [];
  const deps = {
    importWindow: async (window: { from: string; to: string }) => {
      seen.push(window.from);
      return emptyImport(window.from, true);
    },
    reconcileWindow: passVerdict,
  };
  const first = await runMetaAdsIncremental(deps, plan);
  const second = await runMetaAdsIncremental(deps, plan);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(seen, [...plan.refreshDates, ...plan.refreshDates]);
});

test("busy import lock maps to a dedicated already-running error", () => {
  assert.equal(formatMetaAdsLockError("advisory_lock_busy"), "meta_ads_import_already_running");
  assert.equal(formatMetaAdsLockError("other"), "other");
});
