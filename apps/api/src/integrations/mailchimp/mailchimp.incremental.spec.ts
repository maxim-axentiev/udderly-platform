import assert from "node:assert/strict";
import test from "node:test";
import type { MailchimpImportWindowResult } from "./mailchimp-import.service";
import {
  MAILCHIMP_CAMPAIGN_REPORT_LOOKBACK_DAYS,
  MAILCHIMP_FORBIDDEN_PATH_FRAGMENTS,
  MAILCHIMP_IMPORT_LOCK_NAME,
  MAILCHIMP_INCREMENTAL_DAY_OFFSETS,
  MAILCHIMP_INCREMENTAL_LOCK_NAME,
  MAILCHIMP_REPORTING_TIME_ZONE,
} from "./mailchimp.constants";
import { formatMailchimpLockError } from "./mailchimp.errors";
import {
  formatMailchimpIncrementalPlan,
  parseMailchimpIncrementalArgs,
  planMailchimpIncremental,
  runMailchimpIncremental,
} from "./mailchimp.incremental";
import { assertNoPii } from "./mailchimp.sanitize";

function emptyImport(
  date: string,
  options: {
    published?: boolean;
    campaigns?: string[];
    missing?: string[];
  } = {},
): MailchimpImportWindowResult {
  const published = options.published ?? true;
  return {
    accountId: "acct123",
    audienceCount: 1,
    activityRows: published ? 1 : 0,
    providerActivityCount: published ? 1 : 0,
    campaignCount: options.campaigns?.length ?? 0,
    reportCount: options.campaigns?.length ?? 0,
    missingReportIds: options.missing ?? [],
    publishedDates: published ? [date] : [],
    possiblyUnpublishedDates: published ? [] : [date],
    replacedDates: published ? [date] : [],
    replacedCampaignIds: options.campaigns ?? [],
    skippedIncompleteLinkIds: [],
  };
}

const passVerdict = (imported: MailchimpImportWindowResult) => ({
  passed: true as const,
  differences: [],
  diagnostics: [
    ...imported.possiblyUnpublishedDates.map(
      (date) =>
        `possibly unpublished list activity date=${date} (not a gate; existing grains were not replaced)`,
    ),
    ...(imported.missingReportIds.length
      ? [
          `missing campaign reports count=${imported.missingReportIds.length} (not replaced; not a gate)`,
        ]
      : []),
  ],
  totals: {
    rangeLabel: "",
    audienceCount: imported.audienceCount,
    activityRows: imported.activityRows,
    providerActivityCount: imported.providerActivityCount,
    campaignCount: imported.campaignCount,
    reportCount: imported.reportCount,
    missingReportCount: imported.missingReportIds.length,
    publishedDates: imported.publishedDates,
    possiblyUnpublishedDates: imported.possiblyUnpublishedDates,
  },
});

test("plans explicit Toronto offsets 1, 2, 3, 7, 14, and 28 oldest to newest", () => {
  const plan = planMailchimpIncremental({
    dryRun: true,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  assert.deepEqual([...MAILCHIMP_INCREMENTAL_DAY_OFFSETS], [1, 2, 3, 7, 14, 28]);
  assert.equal(MAILCHIMP_CAMPAIGN_REPORT_LOOKBACK_DAYS, 28);
  assert.deepEqual(plan.refreshDates, [
    "2026-09-22",
    "2026-10-06",
    "2026-10-13",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
  ]);
  assert.equal(plan.refreshDates.includes("2026-10-20"), false);
  assert.equal(plan.campaignLookbackFrom, "2026-09-22");
  assert.equal(plan.campaignLookbackTo, "2026-10-19");
  assert.equal(plan.timeZone, "America/Toronto");
  assert.equal(MAILCHIMP_INCREMENTAL_LOCK_NAME, MAILCHIMP_IMPORT_LOCK_NAME);
  assert.equal(MAILCHIMP_INCREMENTAL_LOCK_NAME, "mailchimp-import");
});

test("uses America/Toronto rather than Pacific or UTC", () => {
  const lateUtc = new Date("2026-10-07T06:30:00Z");
  const plan = planMailchimpIncremental({
    dryRun: true,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    now: lateUtc,
  });
  assert.equal(plan.today, "2026-10-07");
  assert.equal(plan.refreshDates.at(-1), "2026-10-06");
});

test("rejects historical range flags so incremental cannot become a backfill", () => {
  assert.throws(
    () => parseMailchimpIncrementalArgs(["--from", "2026-09-30", "--to", "2026-10-01"]),
    /mailchimp_incremental_rejects_from_to_use_import/,
  );
  assert.throws(
    () => parseMailchimpIncrementalArgs(["--members"]),
    /mailchimp_incremental_unknown_flag/,
  );
});

test("dry-run prints the plan with zero importer calls", async () => {
  const plan = parseMailchimpIncrementalArgs(["--dry-run", "--as-of", "2026-10-20"]);
  let account = 0;
  let imported = 0;
  const logs: string[] = [];
  const result = await runMailchimpIncremental(
    {
      importAccount: async () => {
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
  assert.ok(logs.some((line) => line.includes("2026-09-22..2026-10-19")));
  assert.ok(
    formatMailchimpIncrementalPlan(plan).some((line) => line.includes("no Nest boot")),
  );
});

test("unpublished offset is a PASS skip, not a wipe", async () => {
  const plan = planMailchimpIncremental({
    dryRun: false,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const replaced: string[] = [];
  const result = await runMailchimpIncremental(
    {
      importWindow: async (window) => {
        if (window.importCampaigns) {
          return emptyImport(window.from, { published: true, campaigns: ["camp-old"] });
        }
        const published = window.from !== "2026-10-19";
        if (published) {
          replaced.push(window.from);
        }
        return emptyImport(window.from, { published });
      },
      reconcileWindow: passVerdict,
    },
    plan,
  );
  assert.equal(result.ok, true);
  assert.equal(result.completed, 7);
  assert.equal(replaced.includes("2026-10-19"), false);
  assert.ok(
    result.reports.some(
      (item) => item.from === "2026-10-19" && item.published === false,
    ),
  );
});

test("incomplete coverage does not continue after a fetch failure", async () => {
  const plan = planMailchimpIncremental({
    dryRun: false,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const seen: string[] = [];
  const result = await runMailchimpIncremental(
    {
      importWindow: async (window) => {
        seen.push(`${window.from}:${window.importCampaigns ? "campaigns" : "activity"}`);
        if (window.from === "2026-10-06") {
          throw new Error("Mailchimp GET /3.0/lists failed with HTTP 500");
        }
        return emptyImport(window.from, { published: true });
      },
      reconcileWindow: passVerdict,
    },
    plan,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failedDate, "2026-10-06");
  assert.deepEqual(seen, ["2026-09-22:activity", "2026-10-06:activity"]);
  assert.equal(result.completed, 1);
});

test("campaign lookback refreshes send dates between activity offsets", async () => {
  const plan = planMailchimpIncremental({
    dryRun: false,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const campaignWindows: string[] = [];
  const result = await runMailchimpIncremental(
    {
      importWindow: async (window) => {
        if (window.importCampaigns) {
          campaignWindows.push(`${window.from}..${window.to}`);
          return emptyImport(window.from, {
            published: true,
            campaigns: ["camp-2026-10-10"],
          });
        }
        return emptyImport(window.from, { published: true });
      },
      reconcileWindow: passVerdict,
    },
    plan,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(campaignWindows, ["2026-09-22..2026-10-19"]);
  assert.ok(plan.refreshDates.includes("2026-10-10") === false);
  assert.ok(
    result.reports.some((item) =>
      item.replacedCampaignIds.includes("camp-2026-10-10"),
    ),
  );
});

test("revised campaign metrics still replace the reported id on rerun", async () => {
  const plan = planMailchimpIncremental({
    dryRun: false,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const campaignIds: string[][] = [];
  const deps = {
    importWindow: async (window: {
      from: string;
      to: string;
      importCampaigns?: boolean;
    }) => {
      if (window.importCampaigns) {
        campaignIds.push(["camp001"]);
        return emptyImport(window.from, { campaigns: ["camp001"] });
      }
      return emptyImport(window.from, { published: true });
    },
    reconcileWindow: passVerdict,
  };
  const first = await runMailchimpIncremental(deps, plan);
  const second = await runMailchimpIncremental(deps, plan);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(campaignIds, [["camp001"], ["camp001"]]);
});

test("idempotent rerun visits the same explicit activity dates then lookback", async () => {
  const plan = planMailchimpIncremental({
    dryRun: false,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const seen: string[] = [];
  const deps = {
    importWindow: async (window: { from: string; importCampaigns?: boolean }) => {
      seen.push(window.importCampaigns ? "campaigns" : window.from);
      return emptyImport(window.from, {
        published: true,
        campaigns: window.importCampaigns ? ["camp001"] : [],
      });
    },
    reconcileWindow: passVerdict,
  };
  const first = await runMailchimpIncremental(deps, plan);
  const second = await runMailchimpIncremental(deps, plan);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const once = [...plan.refreshDates, "campaigns"];
  assert.deepEqual(seen, [...once, ...once]);
});

test("missing reports and retries remain fail-closed without a wipe", async () => {
  const plan = planMailchimpIncremental({
    dryRun: false,
    timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
    asOf: "2026-10-20",
  });
  const result = await runMailchimpIncremental(
    {
      importWindow: async (window) => {
        if (window.importCampaigns) {
          return emptyImport(window.from, { missing: ["camp-missing"] });
        }
        return emptyImport(window.from, { published: true });
      },
      reconcileWindow: passVerdict,
    },
    plan,
  );
  assert.equal(result.ok, true);
  assert.ok(
    result.reports.some((item) =>
      item.diagnostics.some((line) => line.includes("missing campaign reports")),
    ),
  );
});

test("busy import lock maps to a dedicated already-running error", () => {
  assert.equal(formatMailchimpLockError("advisory_lock_busy"), "mailchimp_import_already_running");
});

test("incremental keeps member endpoints and PII payloads forbidden", () => {
  const plan = formatMailchimpIncrementalPlan(
    planMailchimpIncremental({
      dryRun: true,
      timeZone: MAILCHIMP_REPORTING_TIME_ZONE,
      asOf: "2026-10-20",
    }),
  );
  assert.ok(plan.some((line) => line.includes("member")));
  assert.ok(MAILCHIMP_FORBIDDEN_PATH_FRAGMENTS.includes("/members"));
  assert.throws(
    () => assertNoPii({ members: [{ email_address: "a@b.c" }] }),
    /snapshot_contains_pii/,
  );
});
