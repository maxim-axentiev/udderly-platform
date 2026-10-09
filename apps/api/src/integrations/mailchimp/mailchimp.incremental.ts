import type { MailchimpImportWindowResult } from "./mailchimp-import.service";
import {
  MAILCHIMP_CAMPAIGN_REPORT_LOOKBACK_DAYS,
  MAILCHIMP_INCREMENTAL_DAY_OFFSETS,
  MAILCHIMP_REPORTING_TIME_ZONE,
} from "./mailchimp.constants";
import type { MailchimpReconcileVerdict } from "./mailchimp.reconcile";
import {
  addCalendarDays,
  assertMailchimpDate,
  parseMailchimpWindow,
  todayInTimeZone,
} from "./mailchimp.range";

export type MailchimpIncrementalWindowInput = {
  from: string;
  to: string;
  importActivity?: boolean;
  importCampaigns?: boolean;
};

export type MailchimpIncrementalPlan = {
  today: string;
  timeZone: string;
  dryRun: boolean;
  asOf: string | undefined;
  refreshDates: string[];
  campaignLookbackFrom: string;
  campaignLookbackTo: string;
  order: "oldest-to-newest";
};

export type MailchimpIncrementalStepReport = {
  kind: "activity" | "campaigns";
  from: string;
  to: string;
  published: boolean;
  replacedDates: string[];
  replacedCampaignIds: string[];
  reconciliation: "PASS" | "FAIL";
  differences: string[];
  diagnostics: string[];
};

export type MailchimpIncrementalResult =
  | {
      ok: true;
      dryRun: boolean;
      plan: MailchimpIncrementalPlan;
      completed: number;
      reports: MailchimpIncrementalStepReport[];
    }
  | {
      ok: false;
      dryRun: boolean;
      plan: MailchimpIncrementalPlan;
      completed: number;
      failedDate?: string;
      message: string;
      reports: MailchimpIncrementalStepReport[];
    };

export type MailchimpIncrementalDeps = {
  importAccount?: () => Promise<{ accountId: string }>;
  importWindow: (
    window: MailchimpIncrementalWindowInput,
  ) => Promise<MailchimpImportWindowResult>;
  reconcileWindow: (imported: MailchimpImportWindowResult) => MailchimpReconcileVerdict;
};

export function parseMailchimpIncrementalArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): MailchimpIncrementalPlan {
  if (parseMailchimpWindow(argv) || argv.includes("--from") || argv.includes("--to")) {
    throw new Error("mailchimp_incremental_rejects_from_to_use_import");
  }
  let asOf: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--as-of") {
      asOf = argv[i + 1];
      if (!asOf || asOf.startsWith("--")) {
        throw new Error("mailchimp_incremental_as_of_requires_date");
      }
      assertMailchimpDate(asOf);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error("mailchimp_incremental_unknown_flag");
    }
    throw new Error("mailchimp_incremental_unknown_flag");
  }
  return planMailchimpIncremental({
    dryRun: argv.includes("--dry-run"),
    timeZone: options.timeZone ?? MAILCHIMP_REPORTING_TIME_ZONE,
    now: options.now,
    asOf,
  });
}

export function planMailchimpIncremental(input: {
  dryRun: boolean;
  timeZone: string;
  now?: Date;
  asOf?: string;
}): MailchimpIncrementalPlan {
  const today = input.asOf ?? todayInTimeZone(input.timeZone, input.now);
  if (input.asOf) {
    assertMailchimpDate(input.asOf);
  }
  const unique = new Set<string>();
  for (const offset of MAILCHIMP_INCREMENTAL_DAY_OFFSETS) {
    const date = addCalendarDays(today, -offset);
    if (date >= today) {
      continue;
    }
    unique.add(date);
  }
  const refreshDates = [...unique].sort();
  const campaignLookbackTo = addCalendarDays(today, -1);
  const campaignLookbackFrom = addCalendarDays(
    today,
    -MAILCHIMP_CAMPAIGN_REPORT_LOOKBACK_DAYS,
  );
  return {
    today,
    timeZone: input.timeZone,
    dryRun: input.dryRun,
    asOf: input.asOf,
    refreshDates,
    campaignLookbackFrom:
      campaignLookbackFrom < today ? campaignLookbackFrom : campaignLookbackTo,
    campaignLookbackTo: campaignLookbackTo < today ? campaignLookbackTo : today,
    order: "oldest-to-newest",
  };
}

export function formatMailchimpIncrementalPlan(
  plan: MailchimpIncrementalPlan,
): string[] {
  const lines = [
    `Mailchimp incremental today=${plan.today} timezone=${plan.timeZone}${plan.asOf ? ` as-of=${plan.asOf}` : ""}${plan.dryRun ? " dry-run" : ""}`,
    `activity dates (${plan.refreshDates.length}, ${plan.order}): ${plan.refreshDates.join(", ") || "(none)"}`,
    `campaign report lookback ${plan.campaignLookbackFrom}..${plan.campaignLookbackTo} (send time, America/Toronto)`,
    "list activity replaces only published dates on those offsets; unpublished days do not wipe",
    "campaign reports are current-state upserts for sent campaigns in the lookback; missing reports are skipped",
    "member, email-activity, and recipient-level endpoints are forbidden",
  ];
  if (plan.dryRun) {
    lines.push(
      "dry-run is planning-only: no Nest boot, Mailchimp API, key use, DB, or lock",
    );
  }
  return lines;
}

export async function runMailchimpIncremental(
  deps: MailchimpIncrementalDeps,
  plan: MailchimpIncrementalPlan,
  log: (message: string) => void = console.log,
): Promise<MailchimpIncrementalResult> {
  for (const line of formatMailchimpIncrementalPlan(plan)) {
    log(line);
  }
  if (plan.dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      completed: 0,
      reports: [],
    };
  }

  if (deps.importAccount) {
    await deps.importAccount();
  }

  const reports: MailchimpIncrementalStepReport[] = [];
  let completed = 0;

  for (const date of plan.refreshDates) {
    const result = await runStep(
      deps,
      {
        from: date,
        to: date,
        importActivity: true,
        importCampaigns: false,
      },
      "activity",
      log,
    );
    reports.push(result.report);
    if (!result.ok) {
      return {
        ok: false,
        dryRun: false,
        plan,
        completed,
        failedDate: date,
        message: result.message,
        reports,
      };
    }
    completed += 1;
  }

  const campaignResult = await runStep(
    deps,
    {
      from: plan.campaignLookbackFrom,
      to: plan.campaignLookbackTo,
      importActivity: false,
      importCampaigns: true,
    },
    "campaigns",
    log,
  );
  reports.push(campaignResult.report);
  if (!campaignResult.ok) {
    return {
      ok: false,
      dryRun: false,
      plan,
      completed,
      failedDate: plan.campaignLookbackFrom,
      message: campaignResult.message,
      reports,
    };
  }
  completed += 1;

  log(
    `Mailchimp incremental ${completed}/${plan.refreshDates.length + 1} steps PASS`,
  );
  return {
    ok: true,
    dryRun: false,
    plan,
    completed,
    reports,
  };
}

async function runStep(
  deps: MailchimpIncrementalDeps,
  window: MailchimpIncrementalWindowInput,
  kind: "activity" | "campaigns",
  log: (message: string) => void,
): Promise<
  | { ok: true; report: MailchimpIncrementalStepReport }
  | { ok: false; message: string; report: MailchimpIncrementalStepReport }
> {
  const label = kind === "activity" ? window.from : `${window.from}..${window.to}`;
  try {
    const imported = await deps.importWindow(window);
    const verdict = deps.reconcileWindow(imported);
    const published =
      kind === "activity"
        ? imported.publishedDates.includes(window.from)
        : imported.replacedCampaignIds.length > 0 ||
          imported.missingReportIds.length === 0;
    const report: MailchimpIncrementalStepReport = {
      kind,
      from: window.from,
      to: window.to,
      published,
      replacedDates: imported.replacedDates,
      replacedCampaignIds: imported.replacedCampaignIds,
      reconciliation: verdict.passed ? "PASS" : "FAIL",
      differences: verdict.differences,
      diagnostics: verdict.diagnostics,
    };
    log(
      `${kind} ${label} ${report.reconciliation} ${published ? "published" : "possibly_unpublished"} replacedDates=${imported.replacedDates.join(",") || "(none)"} campaigns=${imported.replacedCampaignIds.join(",") || "(none)"}`,
    );
    for (const line of report.diagnostics) {
      log(`${kind} ${label} ${line}`);
    }
    if (!verdict.passed) {
      const message = verdict.differences.join("; ") || "reconciliation_failed";
      log(`${kind} ${label} FAIL ${message}`);
      return { ok: false, message, report };
    }
    return { ok: true, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${kind} ${label} FAIL ${message}`);
    return {
      ok: false,
      message,
      report: {
        kind,
        from: window.from,
        to: window.to,
        published: false,
        replacedDates: [],
        replacedCampaignIds: [],
        reconciliation: "FAIL",
        differences: [message],
        diagnostics: [],
      },
    };
  }
}
