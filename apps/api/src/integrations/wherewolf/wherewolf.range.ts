import type { WherewolfUtcRange } from "./wherewolf.types";

/** Farm local calendar. User-facing --date / --from / --to use this zone. */
export const FARM_TIME_ZONE = "America/Toronto";

export function farmDayRange(date: string): WherewolfUtcRange {
  assertFarmDate(date);
  const dateBegin = zonedLocalToUtc(date, 0, 0, 0);
  const dateEnd = zonedLocalToUtc(addCalendarDays(date, 1), 0, 0, 0);
  return {
    dateBegin: dateBegin.toISOString(),
    dateEnd: dateEnd.toISOString(),
  };
}

/**
 * Inclusive of both local farm calendar dates.
 * Instant range is half-open UTC: dateBegin <= t < dateEnd.
 */
export function farmInclusiveRange(from: string, to: string): WherewolfUtcRange {
  const begin = farmDayRange(from);
  const end = farmDayRange(to);
  if (Date.parse(end.dateEnd) <= Date.parse(begin.dateBegin)) {
    throw new Error("invalid_date");
  }
  return {
    dateBegin: begin.dateBegin,
    dateEnd: end.dateEnd,
  };
}

export function instantOnFarmDate(instant: Date, date: string): boolean {
  const range = farmDayRange(date);
  const time = instant.getTime();
  return time >= Date.parse(range.dateBegin) && time < Date.parse(range.dateEnd);
}

export function recentUtcRange(days: number): WherewolfUtcRange {
  const dateEnd = new Date();
  const dateBegin = new Date(dateEnd.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    dateBegin: dateBegin.toISOString(),
    dateEnd: dateEnd.toISOString(),
  };
}

export function zonedLocalToUtc(
  date: string,
  hour: number,
  minute: number,
  second: number,
): Date {
  assertFarmDate(date);
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = new Date(utcGuess - tzOffsetMs(new Date(utcGuess)));
  return new Date(utcGuess - tzOffsetMs(first));
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day + days);
  return new Date(utc).toISOString().slice(0, 10);
}

function tzOffsetMs(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: FARM_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

function assertFarmDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("invalid_date");
  }
}
