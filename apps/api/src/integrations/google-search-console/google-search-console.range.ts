import {
  GSC_EARLIEST_USEFUL_DATE,
  GSC_REPORTING_TIME_ZONE,
} from "./google-search-console.constants";
import type { GscDateWindow } from "./google-search-console.types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertGscDate(value: string): void {
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

export function parseGscWindow(argv: string[]): GscDateWindow | undefined {
  const fromIndex = argv.indexOf("--from");
  const toIndex = argv.indexOf("--to");
  if (fromIndex >= 0 && toIndex >= 0) {
    const from = argv[fromIndex + 1];
    const to = argv[toIndex + 1];
    if (!from || !to) {
      return undefined;
    }
    assertGscDate(from);
    assertGscDate(to);
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
  assertGscDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function gscDatesInclusive(from: string, to: string): string[] {
  assertGscDate(from);
  assertGscDate(to);
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

export function lastCompletedDate(timeZone: string, now = new Date()): string {
  return addCalendarDays(todayInTimeZone(timeZone, now), -1);
}

export function assertHistoricalGscRange(
  from: string,
  to: string,
  timeZone: string = GSC_REPORTING_TIME_ZONE,
  now = new Date(),
): void {
  assertGscDate(from);
  assertGscDate(to);
  if (from < GSC_EARLIEST_USEFUL_DATE) {
    throw new Error("gsc_range_before_earliest_useful_date");
  }
  if (from > to) {
    throw new Error("invalid_date");
  }
  if (to > lastCompletedDate(timeZone, now)) {
    throw new Error("gsc_range_includes_current_or_future_day");
  }
}

export function weekChunks(from: string, to: string): GscDateWindow[] {
  assertGscDate(from);
  assertGscDate(to);
  const chunks: GscDateWindow[] = [];
  let cursor = from;
  while (cursor <= to) {
    const weekEnd = addCalendarDays(cursor, 6);
    const end = weekEnd < to ? weekEnd : to;
    chunks.push({ from: cursor, to: end });
    cursor = addCalendarDays(end, 1);
  }
  return chunks;
}
