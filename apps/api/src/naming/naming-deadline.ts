const TORONTO = "America/Toronto";

export const PURCHASE_DEADLINE_DAY = { year: 2026, month: 12, day: 31 } as const;
export const NAMING_SUBMISSION_DEADLINE_DAY = {
  year: 2027,
  month: 1,
  day: 14,
} as const;

const PURCHASE_DEADLINE = "December 31, 2026 at 11:59 p.m. Eastern Time";
const NAMING_DEADLINE = "January 14, 2027 at 11:59 p.m. Eastern Time";

export const PURCHASE_CLOSED_MESSAGE =
  `The naming campaign ended on ${PURCHASE_DEADLINE}. A gift card can no longer include naming rights.`;

export const NAMING_CLOSED_MESSAGE =
  `Names can no longer be submitted. The deadline was ${NAMING_DEADLINE}.`;

export const RECOGNITION_PERIOD_MESSAGE =
  "This name is recognized at Udderly Ridiculous from February 1, 2027 through January 31, 2028.";

type CalendarDay = { year: number; month: number; day: number };

/**
 * Campaign instants are America/Toronto civil days. The comparison uses the
 * UTC instant of the next local midnight, so the server timezone does not
 * decide the result. 11:59 p.m. includes the whole local day.
 */
export function isOnOrBeforeTorontoDay(instant: Date, day: CalendarDay): boolean {
  return instant.getTime() < torontoStartOfNextDay(day).getTime();
}

export function qualifiesForPurchaseDeadline(paidAt: Date): boolean {
  return isOnOrBeforeTorontoDay(paidAt, PURCHASE_DEADLINE_DAY);
}

export function namingSubmissionOpen(now: Date): boolean {
  return isOnOrBeforeTorontoDay(now, NAMING_SUBMISSION_DEADLINE_DAY);
}

export function torontoStartOfNextDay(day: CalendarDay): Date {
  const next = addCalendarDay(day);
  return zonedWallTimeToUtc(
    { ...next, hour: 0, minute: 0, second: 0 },
    TORONTO,
  );
}

type WallTime = CalendarDay & { hour: number; minute: number; second: number };

function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  let utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = readWall(formatter, new Date(utc));
    const delta =
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
      Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
      );
    if (delta === 0) {
      return new Date(utc);
    }
    utc += delta;
  }
  throw new Error("naming_timezone_unresolved");
}

function readWall(formatter: Intl.DateTimeFormat, instant: Date): WallTime {
  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const hour = value("hour");
  const wall = {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour,
    minute: value("minute"),
    second: value("second"),
  };
  if (hour === 24) {
    const next = addCalendarDay(wall);
    return { ...next, hour: 0, minute: wall.minute, second: wall.second };
  }
  return wall;
}

function addCalendarDay(day: CalendarDay): CalendarDay {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day));
  date.setUTCDate(date.getUTCDate() + 1);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}
