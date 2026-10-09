import { mailchimpDatesInclusive } from "./mailchimp.range";

export type MailchimpWindowCoverage = {
  publishedDates: string[];
  possiblyUnpublishedDates: string[];
};

export function publishedDatesForDays(days: readonly string[]): string[] {
  return [...new Set(days)].sort();
}

export function classifyMailchimpActivityCoverage(input: {
  from: string;
  to: string;
  activityDays: readonly string[];
}): MailchimpWindowCoverage {
  const publishedDates = publishedDatesForDays(input.activityDays);
  const published = new Set(publishedDates);
  const possiblyUnpublishedDates = mailchimpDatesInclusive(input.from, input.to).filter(
    (date) => !published.has(date),
  );
  return { publishedDates, possiblyUnpublishedDates };
}

export function daysForDates(
  days: readonly string[],
  dates: readonly string[],
): string[] {
  const allowed = new Set(dates);
  return days.filter((day) => allowed.has(day));
}
