import { MAILCHIMP_REPORTING_TIME_ZONE } from "./mailchimp.constants";
import {
  assertHistoricalMailchimpRange,
  parseMailchimpWindow,
} from "./mailchimp.range";

export type MailchimpImportPlan = {
  dryRun: boolean;
  accountOnly: boolean;
  from?: string;
  to?: string;
  timeZone: string;
};

export function parseMailchimpImportArgs(
  argv: string[],
  options: { timeZone?: string; now?: Date } = {},
): MailchimpImportPlan {
  const accountOnly = argv.includes("--account-only");
  const dryRun = argv.includes("--dry-run");
  const window = parseMailchimpWindow(argv);
  if (!accountOnly && !window) {
    throw new Error("mailchimp_import_requires_from_to_or_account_only");
  }
  if (window) {
    assertHistoricalMailchimpRange(
      window.from,
      window.to,
      options.timeZone ?? MAILCHIMP_REPORTING_TIME_ZONE,
      options.now,
    );
  }
  for (const arg of argv) {
    if (
      arg !== "--dry-run" &&
      arg !== "--account-only" &&
      arg !== "--from" &&
      arg !== "--to" &&
      arg.startsWith("--")
    ) {
      throw new Error("mailchimp_import_unknown_flag");
    }
  }
  return {
    dryRun,
    accountOnly,
    from: window?.from,
    to: window?.to,
    timeZone: options.timeZone ?? MAILCHIMP_REPORTING_TIME_ZONE,
  };
}

export function formatMailchimpImportPlan(plan: MailchimpImportPlan): string[] {
  const lines = [
    `Mailchimp import timezone=${plan.timeZone}${plan.dryRun ? " dry-run" : ""}`,
  ];
  if (plan.accountOnly) {
    lines.push("mode=account-only");
  }
  if (plan.from && plan.to) {
    lines.push(`range ${plan.from}..${plan.to}`);
  }
  lines.push(
    "resources: account, audiences, growth-history, list-activity, sent campaigns, reports, click-details",
  );
  lines.push("member, email-activity, and recipient-level endpoints are forbidden");
  if (plan.dryRun) {
    lines.push(
      "dry-run is planning-only: no Nest boot, Mailchimp API, key use, DB, or lock",
    );
    lines.push(
      "days with no list activity rows are possibly unpublished and will not replace canonical grains",
    );
    lines.push(
      "sent campaigns without a report are skipped for report replacement (not a wipe)",
    );
  }
  return lines;
}
