import { assertMailchimpDate, assertMailchimpMonth } from "./mailchimp.range";
import type {
  MailchimpActivityDay,
  MailchimpCampaignLink,
  MailchimpGrowthMonth,
} from "./mailchimp.types";

export function normalizeGrowthMonth(
  listId: string,
  payload: Record<string, unknown>,
): MailchimpGrowthMonth {
  const month = requiredString(payload.month, "malformed_row");
  assertMailchimpMonth(month);
  return {
    listId,
    month,
    subscribed: optionalInt(payload.subscribed),
    unsubscribed: optionalInt(payload.unsubscribed),
    cleaned: optionalInt(payload.cleaned),
    deleted: optionalInt(payload.deleted),
    pending: optionalInt(payload.pending),
    reconfirm: optionalInt(payload.reconfirm),
  };
}

export function normalizeActivityDay(
  listId: string,
  payload: Record<string, unknown>,
): MailchimpActivityDay {
  const day = requiredString(payload.day, "malformed_row");
  assertMailchimpDate(day);
  return {
    listId,
    day,
    emailsSent: optionalInt(payload.emails_sent),
    uniqueOpens: optionalInt(payload.unique_opens),
    recipientClicks: optionalInt(payload.recipient_clicks),
    hardBounce: optionalInt(payload.hard_bounce),
    softBounce: optionalInt(payload.soft_bounce),
    subs: optionalInt(payload.subs),
    unsubs: optionalInt(payload.unsubs),
    otherAdds: optionalInt(payload.other_adds),
    otherRemoves: optionalInt(payload.other_removes),
  };
}

export function normalizeClickDetail(
  campaignId: string,
  payload: Record<string, unknown>,
): MailchimpCampaignLink {
  return {
    campaignId,
    linkId: requiredString(payload.id, "malformed_row"),
    url: optionalString(payload.url),
    totalClicks: optionalInt(payload.total_clicks),
    uniqueClicks: optionalInt(payload.unique_clicks),
  };
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(error);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}
