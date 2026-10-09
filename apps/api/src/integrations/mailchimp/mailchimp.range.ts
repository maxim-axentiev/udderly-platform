import { MAILCHIMP_REPORTING_TIME_ZONE } from "./mailchimp.constants";
import type { MailchimpDateWindow } from "./mailchimp.types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

export function assertMailchimpDate(value: string): void {
  if (!DATE.test(value)) {
    throw new Error("invalid_date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utc).toISOString().slice(0, 10);
  if (roundTrip !== value) {
    throw new Error("invalid_date");
  }
}

export function assertMailchimpMonth(value: string): void {
  if (!MONTH.test(value)) {
    throw new Error("invalid_month");
  }
  assertMailchimpDate(`${value}-01`);
}

export function parseMailchimpWindow(argv: string[]): MailchimpDateWindow | undefined {
  const fromIndex = argv.indexOf("--from");
  const toIndex = argv.indexOf("--to");
  if (fromIndex >= 0 && toIndex >= 0) {
    const from = argv[fromIndex + 1];
    const to = argv[toIndex + 1];
    if (!from || !to) {
      return undefined;
    }
    assertMailchimpDate(from);
    assertMailchimpDate(to);
    if (from > to) {
      throw new Error("invalid_date");
    }
    return { from, to };
  }
  return undefined;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(date: string, days: number): string {
  assertMailchimpDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function lastCompletedDate(timeZone: string, now = new Date()): string {
  return addCalendarDays(todayInTimeZone(timeZone, now), -1);
}

export function mailchimpDatesInclusive(from: string, to: string): string[] {
  assertMailchimpDate(from);
  assertMailchimpDate(to);
  if (from > to) {
    throw new Error("invalid_date");
  }
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
}

export function monthsOverlappingRange(from: string, to: string): string[] {
  assertMailchimpDate(from);
  assertMailchimpDate(to);
  const months: string[] = [];
  let cursor = from.slice(0, 7);
  const last = to.slice(0, 7);
  while (cursor <= last) {
    months.push(cursor);
    const [year, month] = cursor.split("-").map(Number);
    const next = month === 12 ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, month, 1);
    cursor = new Date(next).toISOString().slice(0, 7);
  }
  return months;
}

export function civilDateInTimeZone(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid_datetime");
  }
  return todayInTimeZone(timeZone, parsed);
}

export function assertHistoricalMailchimpRange(
  from: string,
  to: string,
  timeZone: string = MAILCHIMP_REPORTING_TIME_ZONE,
  now = new Date(),
): void {
  assertMailchimpDate(from);
  assertMailchimpDate(to);
  if (from > to) {
    throw new Error("invalid_date");
  }
  if (to > lastCompletedDate(timeZone, now)) {
    throw new Error("mailchimp_range_includes_current_or_future_day");
  }
}
