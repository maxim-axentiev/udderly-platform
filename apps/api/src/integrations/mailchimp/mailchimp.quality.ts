import {
  MAILCHIMP_APPROVED_ACCOUNT_TIME_ZONES,
} from "./mailchimp.constants";

export function isApprovedMailchimpAccountTimeZone(value: string): boolean {
  return (MAILCHIMP_APPROVED_ACCOUNT_TIME_ZONES as readonly string[]).includes(
    value,
  );
}

export function qualityFailure(input: { timezone?: string }): string | undefined {
  if (!input.timezone) {
    return "mailchimp_timezone_missing";
  }
  if (!isApprovedMailchimpAccountTimeZone(input.timezone)) {
    return "mailchimp_timezone_unsupported";
  }
  return undefined;
}

export function assertMailchimpQuality(input: { timezone?: string }): void {
  const error = qualityFailure(input);
  if (error) {
    throw new Error(error);
  }
}
