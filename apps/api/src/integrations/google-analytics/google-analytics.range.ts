import { GA_EARLIEST_USEFUL_DATE } from "./google-analytics.constants";
import type { GaDateWindow } from "./google-analytics.types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertGaDate(value: string): void {
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

export function parseGaWindow(argv: string[]): GaDateWindow | undefined {
  const fromIndex = argv.indexOf("--from");
  const toIndex = argv.indexOf("--to");
  if (fromIndex >= 0 && toIndex >= 0) {
    const from = argv[fromIndex + 1];
    const to = argv[toIndex + 1];
    if (!from || !to) {
      return undefined;
    }
    assertGaDate(from);
    assertGaDate(to);
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
  assertGaDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function farmDatesInclusive(from: string, to: string): string[] {
  assertGaDate(from);
  assertGaDate(to);
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

export function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clampToEarliest(from: string): string {
  assertGaDate(from);
  return from < GA_EARLIEST_USEFUL_DATE ? GA_EARLIEST_USEFUL_DATE : from;
}

export function lastCompletedDate(timeZone: string, now = new Date()): string {
  return addCalendarDays(todayInTimeZone(timeZone, now), -1);
}

export function assertHistoricalGaRange(
  from: string,
  to: string,
  timeZone: string,
  now = new Date(),
): void {
  assertGaDate(from);
  assertGaDate(to);
  if (from < GA_EARLIEST_USEFUL_DATE) {
    throw new Error("ga_range_before_earliest_useful_date");
  }
  if (from > to) {
    throw new Error("invalid_date");
  }
  if (to > lastCompletedDate(timeZone, now)) {
    throw new Error("ga_range_includes_current_or_future_day");
  }
}

export function gaDateToFarmDate(value: string): string {
  if (DATE.test(value)) {
    assertGaDate(value);
    return value;
  }
  if (/^\d{8}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    assertGaDate(iso);
    return iso;
  }
  throw new Error("malformed_ga_date");
}

export function monthChunks(from: string, to: string): GaDateWindow[] {
  assertGaDate(from);
  assertGaDate(to);
  const chunks: GaDateWindow[] = [];
  let cursor = from;
  while (cursor <= to) {
    const [year, month] = cursor.split("-").map(Number);
    const monthEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = `${cursor.slice(0, 7)}-${String(monthEndDay).padStart(2, "0")}`;
    const end = monthEnd < to ? monthEnd : to;
    chunks.push({ from: cursor, to: end });
    cursor = addCalendarDays(end, 1);
  }
  return chunks;
}

export function weekChunks(from: string, to: string): GaDateWindow[] {
  assertGaDate(from);
  assertGaDate(to);
  const chunks: GaDateWindow[] = [];
  let cursor = from;
  while (cursor <= to) {
    const weekEnd = addCalendarDays(cursor, 6);
    const end = weekEnd < to ? weekEnd : to;
    chunks.push({ from: cursor, to: end });
    cursor = addCalendarDays(end, 1);
  }
  return chunks;
}
