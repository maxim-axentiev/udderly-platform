export const MAILCHIMP_PROVIDER = "mailchimp";

export const MAILCHIMP_ACCOUNT_ENTITY = "account";
export const MAILCHIMP_AUDIENCE_ENTITY = "audience";
export const MAILCHIMP_GROWTH_HISTORY_ENTITY = "growth_history";
export const MAILCHIMP_LIST_ACTIVITY_ENTITY = "list_activity";
export const MAILCHIMP_CAMPAIGN_ENTITY = "campaign";
export const MAILCHIMP_CAMPAIGN_REPORT_ENTITY = "campaign_report";
export const MAILCHIMP_CLICK_REPORT_ENTITY = "click_report";

export const MAILCHIMP_API_VERSION = "3.0";
export const MAILCHIMP_REPORTING_TIME_ZONE = "America/Toronto";

/**
 * Mailchimp account IANA zones that currently share EST/EDT with Toronto.
 * Canonical farm dates still use MAILCHIMP_REPORTING_TIME_ZONE.
 */
export const MAILCHIMP_APPROVED_ACCOUNT_TIME_ZONES = [
  "America/Toronto",
  "America/New_York",
] as const;

export const MAILCHIMP_MAX_RETRIES = 4;
export const MAILCHIMP_REQUEST_TIMEOUT_MS = 60_000;
export const MAILCHIMP_PAGE_COUNT = 100;
export const MAILCHIMP_MAX_PAGES = 50;

/**
 * Discrete completed Toronto-calendar offsets for list activity.
 * 1–3 catch near-term revisions; 7/14/28 catch later activity without a backfill.
 */
export const MAILCHIMP_INCREMENTAL_DAY_OFFSETS = [1, 2, 3, 7, 14, 28] as const;

/**
 * Contiguous send-time lookback for revisable campaign report totals.
 * Matches the oldest activity offset so campaigns sent between activity
 * dates still receive current unique-open / click totals.
 */
export const MAILCHIMP_CAMPAIGN_REPORT_LOOKBACK_DAYS = 28;

/** Shared by bounded import and incremental so they cannot overlap. */
export const MAILCHIMP_IMPORT_LOCK_NAME = "mailchimp-import";
export const MAILCHIMP_INCREMENTAL_LOCK_NAME = MAILCHIMP_IMPORT_LOCK_NAME;

/**
 * Path fragments that return subscriber PII. The GET-only client refuses these
 * even if a caller constructs the URL.
 */
export const MAILCHIMP_FORBIDDEN_PATH_FRAGMENTS = [
  "/members",
  "/email-activity",
  "/unsubscribed",
  "/sent-to",
  "/abuse-reports",
  "/search-members",
] as const;
