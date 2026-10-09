import type { MailchimpJson } from "./mailchimp.types";

const ACCOUNT_KEYS = [
  "account_id",
  "account_name",
  "account_timezone",
  "timezone",
] as const;

const AUDIENCE_KEYS = ["id", "name", "stats"] as const;

const AUDIENCE_STATS_KEYS = [
  "member_count",
  "unsubscribe_count",
  "cleaned_count",
  "member_count_since_send",
  "unsubscribe_count_since_send",
  "cleaned_count_since_send",
  "campaign_count",
  "campaign_last_sent",
  "avg_sub_rate",
  "avg_unsub_rate",
  "target_sub_rate",
  "open_rate",
  "click_rate",
] as const;

const GROWTH_KEYS = [
  "list_id",
  "month",
  "subscribed",
  "unsubscribed",
  "cleaned",
  "deleted",
  "pending",
  "reconfirm",
] as const;

const ACTIVITY_KEYS = [
  "day",
  "emails_sent",
  "unique_opens",
  "recipient_clicks",
  "hard_bounce",
  "soft_bounce",
  "subs",
  "unsubs",
  "other_adds",
  "other_removes",
] as const;

const CAMPAIGN_KEYS = ["id", "type", "status", "send_time", "settings", "recipients", "tracking"] as const;

const CAMPAIGN_SETTINGS_KEYS = ["title", "subject_line", "preview_text"] as const;

const CAMPAIGN_RECIPIENT_KEYS = ["list_id", "list_name", "recipient_count"] as const;

const CAMPAIGN_TRACKING_KEYS = ["google_analytics"] as const;

const REPORT_KEYS = [
  "id",
  "campaign_title",
  "type",
  "list_id",
  "list_name",
  "subject_line",
  "preview_text",
  "emails_sent",
  "abuse_reports",
  "unsubscribed",
  "send_time",
  "bounces",
  "forwards",
  "opens",
  "clicks",
] as const;

const BOUNCE_KEYS = ["hard_bounces", "soft_bounces", "syntax_errors"] as const;
const FORWARD_KEYS = ["forwards_count", "forwards_opens"] as const;
const OPEN_KEYS = [
  "opens_total",
  "unique_opens",
  "open_rate",
  "last_open",
  "proxy_excluded_opens",
  "proxy_excluded_unique_opens",
  "proxy_excluded_open_rate",
] as const;
const CLICK_SUMMARY_KEYS = [
  "clicks_total",
  "unique_clicks",
  "unique_subscriber_clicks",
  "click_rate",
  "last_click",
] as const;

const LINK_KEYS = [
  "id",
  "url",
  "total_clicks",
  "unique_clicks",
  "click_percentage",
  "unique_click_percentage",
  "last_click",
] as const;

const BANNED_KEYS = [
  "email",
  "email_address",
  "emails",
  "merge_fields",
  "members",
  "subscribers",
  "full_name",
  "first_name",
  "last_name",
  "fname",
  "lname",
  "phone",
  "share_password",
  "share_url",
  "contact",
  "api_key",
  "access_token",
] as const;

export function sanitizeAccount(payload: MailchimpJson): Record<string, unknown> {
  const picked = pick(payload, [...ACCOUNT_KEYS]);
  const iana =
    (typeof picked.account_timezone === "string" ? picked.account_timezone : undefined) ??
    (typeof picked.timezone === "string" ? picked.timezone : undefined);
  delete picked.account_timezone;
  if (iana) {
    picked.timezone = iana;
  } else {
    delete picked.timezone;
  }
  return picked;
}

export function sanitizeAudience(payload: MailchimpJson): Record<string, unknown> {
  const picked = pick(payload, [...AUDIENCE_KEYS]);
  if (picked.stats && typeof picked.stats === "object") {
    picked.stats = pick(picked.stats as MailchimpJson, [...AUDIENCE_STATS_KEYS]);
  }
  return picked;
}

export function sanitizeGrowthMonth(payload: MailchimpJson): Record<string, unknown> {
  return pick(payload, [...GROWTH_KEYS]);
}

export function sanitizeActivityDay(payload: MailchimpJson): Record<string, unknown> {
  return pick(payload, [...ACTIVITY_KEYS]);
}

export function sanitizeCampaign(payload: MailchimpJson): Record<string, unknown> {
  const picked = pick(payload, [...CAMPAIGN_KEYS]);
  if (picked.settings && typeof picked.settings === "object") {
    picked.settings = pick(picked.settings as MailchimpJson, [...CAMPAIGN_SETTINGS_KEYS]);
  }
  if (picked.recipients && typeof picked.recipients === "object") {
    picked.recipients = pick(picked.recipients as MailchimpJson, [
      ...CAMPAIGN_RECIPIENT_KEYS,
    ]);
  }
  if (picked.tracking && typeof picked.tracking === "object") {
    const tracking = pick(picked.tracking as MailchimpJson, [...CAMPAIGN_TRACKING_KEYS]);
    if (typeof tracking.google_analytics !== "string") {
      delete tracking.google_analytics;
    }
    picked.tracking = tracking;
  }
  return picked;
}

export function sanitizeCampaignReport(payload: MailchimpJson): Record<string, unknown> {
  const picked = pick(payload, [...REPORT_KEYS]);
  if (picked.bounces && typeof picked.bounces === "object") {
    picked.bounces = pick(picked.bounces as MailchimpJson, [...BOUNCE_KEYS]);
  }
  if (picked.forwards && typeof picked.forwards === "object") {
    picked.forwards = pick(picked.forwards as MailchimpJson, [...FORWARD_KEYS]);
  }
  if (picked.opens && typeof picked.opens === "object") {
    picked.opens = pick(picked.opens as MailchimpJson, [...OPEN_KEYS]);
  }
  if (picked.clicks && typeof picked.clicks === "object") {
    picked.clicks = pick(picked.clicks as MailchimpJson, [...CLICK_SUMMARY_KEYS]);
  }
  return picked;
}

export function sanitizeClickDetail(payload: MailchimpJson): Record<string, unknown> {
  const picked = pick(payload, [...LINK_KEYS]);
  if (typeof picked.url === "string") {
    picked.url = stripUrlUserinfo(picked.url);
  }
  return picked;
}

export function assertNoSecrets(payload: unknown): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const banned of ["access_token", "api_key", "apikey", "authorization"]) {
    if (serialized.includes(banned)) {
      throw new Error("snapshot_contains_secret");
    }
  }
}

export function assertNoPii(payload: unknown): void {
  walkBannedKeys(payload);
}

function walkBannedKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkBannedKeys(item);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_KEYS.includes(key as (typeof BANNED_KEYS)[number])) {
      throw new Error("snapshot_contains_pii");
    }
    walkBannedKeys(child);
  }
}

function stripUrlUserinfo(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function pick(
  payload: MailchimpJson,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in payload) {
      out[key] = payload[key];
    }
  }
  return out;
}
