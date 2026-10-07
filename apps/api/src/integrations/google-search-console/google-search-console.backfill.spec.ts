import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGscBackfillArgs,
  planGscBackfill,
  runGscBackfill,
} from "./google-search-console.backfill";
import type { GscImportWindowResult } from "./google-search-console-import.service";
import { GSC_REPORT_DEFINITIONS } from "./google-search-console.reports";

const NOW = new Date("2026-10-06T20:00:00Z");
const TZ = "America/Los_Angeles";

function emptyImport(from: string, to: string): GscImportWindowResult {
  return {
    siteUrl: "sc-domain:udderlyridiculousfarmlife.com",
    families: GSC_REPORT_DEFINITIONS.map((definition) => ({
      family: definition.id,
      startDate: from,
      endDate: to,
      sourceRows: 0,
      providerRowCount: 0,
      canonicalRows: 0,
      unresolvedRows: 0,
      requestCount: 1,
      dataState: "final",
      searchType: "web",
    })),
    factsByFamily: {},
    publishedDates: [],
    possiblyUnpublishedDates: [from],
    replacedDates: [],
  };
}

test("requires from/to and rejects pre-history dates", () => {
  assert.throws(() => parseGscBackfillArgs(["--from", "2026-09-30"], { now: NOW }), /gsc_backfill_requires_from_to/);
  assert.throws(
    () =>
      planGscBackfill({
        from: "2026-09-29",
        to: "2026-09-30",
        dryRun: true,
        timeZone: TZ,
        now: NOW,
      }),
    /gsc_range_before_earliest_useful_date/,
  );
});

test("dry-run prints chunks without importer calls", async () => {
  const plan = parseGscBackfillArgs(
    ["--from", "2026-09-30", "--to", "2026-10-04", "--dry-run"],
    { now: NOW },
  );
  let imported = 0;
  let site = 0;
  const logs: string[] = [];
  const result = await runGscBackfill(
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
  assert.equal(imported, 0);
  assert.equal(site, 0);
  assert.ok(logs.some((line) => line.includes("dry-run chunk")));
});

test("live backfill stops on the first failed chunk", async () => {
  const plan = planGscBackfill({
    from: "2026-09-30",
    to: "2026-10-04",
    dryRun: false,
    timeZone: TZ,
    now: NOW,
  });
  const result = await runGscBackfill(
    {
      importWindow: async (window) => emptyImport(window.from, window.to),
      reconcileWindow: () => ({
        passed: false,
        differences: ["fail"],
        diagnostics: [],
        totals: { rangeLabel: "", families: [], publishedDates: [], possiblyUnpublishedDates: [] },
      }),
    },
    plan,
  );
  assert.equal(result.ok, false);
  assert.equal(result.completed, 0);
});
