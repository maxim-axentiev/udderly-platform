export type MailchimpJson = Record<string, unknown>;

export type MailchimpClientConfig = {
  apiKey: string;
  timeoutMs?: number;
  pageCount?: number;
  maxPages?: number;
  retryBackoffMs?: number;
  fetchImpl?: typeof fetch;
};

export type MailchimpDateWindow = {
  from: string;
  to: string;
};

export type MailchimpPagedResult<T> = {
  items: T[];
  totalItems: number;
  requestCount: number;
};

export type MailchimpGrowthMonth = {
  listId: string;
  month: string;
  subscribed?: number;
  unsubscribed?: number;
  cleaned?: number;
  deleted?: number;
  pending?: number;
  reconfirm?: number;
};

export type MailchimpActivityDay = {
  listId: string;
  day: string;
  emailsSent?: number;
  uniqueOpens?: number;
  recipientClicks?: number;
  hardBounce?: number;
  softBounce?: number;
  subs?: number;
  unsubs?: number;
  otherAdds?: number;
  otherRemoves?: number;
};

export type MailchimpCampaignLink = {
  campaignId: string;
  linkId: string;
  url?: string;
  totalClicks?: number;
  uniqueClicks?: number;
};
