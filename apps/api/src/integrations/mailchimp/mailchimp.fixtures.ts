import type { MailchimpJson } from "./mailchimp.types";

export const MOCK_MAILCHIMP_API_KEY = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us21";

export const mockAccount: MailchimpJson = {
  account_id: "acct123",
  account_name: "Udderly Ridiculous Farm Life",
  timezone: "America/Toronto",
  email: "owner@example.com",
  first_name: "Redacted",
  last_name: "Person",
};

export const mockAudience: MailchimpJson = {
  id: "list001abc",
  name: "Farm newsletter",
  stats: {
    member_count: 120,
    unsubscribe_count: 3,
    cleaned_count: 1,
    campaign_count: 4,
    open_rate: 32.1,
    click_rate: 4.2,
  },
  members: [{ email_address: "secret@example.com" }],
};

export const mockGrowth: MailchimpJson = {
  list_id: "list001abc",
  month: "2026-09",
  subscribed: 118,
  unsubscribed: 2,
  cleaned: 1,
  deleted: 0,
  pending: 0,
  reconfirm: 0,
};

export const mockActivity: MailchimpJson = {
  day: "2026-09-30",
  emails_sent: 110,
  unique_opens: 40,
  recipient_clicks: 8,
  hard_bounce: 0,
  soft_bounce: 1,
  subs: 2,
  unsubs: 1,
  other_adds: 0,
  other_removes: 0,
};

export const mockCampaign: MailchimpJson = {
  id: "camp001",
  type: "regular",
  status: "sent",
  send_time: "2026-09-30T14:00:00+00:00",
  settings: {
    title: "September farm news",
    subject_line: "This week at the farm",
    preview_text: "Openings and goats",
  },
  recipients: {
    list_id: "list001abc",
    list_name: "Farm newsletter",
    recipient_count: 110,
  },
  tracking: { google_analytics: "mc-september-farm-news" },
};

export const mockReport: MailchimpJson = {
  id: "camp001",
  campaign_title: "September farm news",
  type: "regular",
  list_id: "list001abc",
  list_name: "Farm newsletter",
  subject_line: "This week at the farm",
  emails_sent: 110,
  abuse_reports: 0,
  unsubscribed: 1,
  send_time: "2026-09-30T14:00:00+00:00",
  bounces: { hard_bounces: 0, soft_bounces: 1, syntax_errors: 0 },
  opens: {
    opens_total: 55,
    unique_opens: 40,
    open_rate: 36.36,
    proxy_excluded_unique_opens: 28,
  },
  clicks: {
    clicks_total: 12,
    unique_clicks: 8,
    unique_subscriber_clicks: 8,
    click_rate: 7.27,
  },
  share_report: { share_password: "vip-secret", share_url: "https://example.invalid/report" },
};

export const mockClick: MailchimpJson = {
  id: "link001",
  url: "https://udderlyridiculousfarmlife.com/visit",
  total_clicks: 7,
  unique_clicks: 6,
  click_percentage: 58.3,
};
