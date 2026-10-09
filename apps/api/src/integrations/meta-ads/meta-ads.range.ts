import { META_ADS_REPORTING_TIME_ZONE } from "./meta-ads.constants";
import type { MetaAdsDateWindow } from "./meta-ads.types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertMetaAdsDate(value: string): void {
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

export function parseMetaAdsWindow(argv: string[]): MetaAdsDateWindow | undefined {
  const fromIndex = argv.indexOf("--from");
  const toIndex = argv.indexOf("--to");
  if (fromIndex >= 0 && toIndex >= 0) {
    const from = argv[fromIndex + 1];
    const to = argv[toIndex + 1];
    if (!from || !to) {
      return undefined;
    }
    assertMetaAdsDate(from);
    assertMetaAdsDate(to);
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
  assertMetaAdsDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function lastCompletedDate(timeZone: string, now = new Date()): string {
  return addCalendarDays(todayInTimeZone(timeZone, now), -1);
}

export function metaAdsDatesInclusive(from: string, to: string): string[] {
  assertMetaAdsDate(from);
  assertMetaAdsDate(to);
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

export function assertHistoricalMetaAdsRange(
  from: string,
  to: string,
  timeZone: string = META_ADS_REPORTING_TIME_ZONE,
  now = new Date(),
): void {
  assertMetaAdsDate(from);
  assertMetaAdsDate(to);
  if (from > to) {
    throw new Error("invalid_date");
  }
  if (to > lastCompletedDate(timeZone, now)) {
    throw new Error("meta_ads_range_includes_current_or_future_day");
  }
}
