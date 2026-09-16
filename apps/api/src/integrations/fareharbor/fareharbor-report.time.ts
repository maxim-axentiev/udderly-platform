import { zonedLocalToUtc } from "../wherewolf/wherewolf.range";

export function parseFarmDateTime(value: string): Date | undefined {
  const text = value.trim();
  if (!text) {
    return undefined;
  }

  const atMatch = text.match(
    /^(\d{4}-\d{2}-\d{2})\s*@\s*(\d{1,2}):(\d{2})\s*(am|pm)$/i,
  );
  if (atMatch?.[1] && atMatch[2] && atMatch[3] && atMatch[4]) {
    return farmLocal(
      atMatch[1],
      toHour24(Number(atMatch[2]), atMatch[4]),
      Number(atMatch[3]),
    );
  }

  const twelveMatch = text.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i,
  );
  if (
    twelveMatch?.[1] &&
    twelveMatch[2] &&
    twelveMatch[3] &&
    twelveMatch[5]
  ) {
    return farmLocal(
      twelveMatch[1],
      toHour24(Number(twelveMatch[2]), twelveMatch[5]),
      Number(twelveMatch[3]),
      twelveMatch[4] ? Number(twelveMatch[4]) : 0,
    );
  }

  const twentyFour = text.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (
    twentyFour?.[1] &&
    twentyFour[2] &&
    twentyFour[3] &&
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(text)
  ) {
    return farmLocal(
      twentyFour[1],
      Number(twentyFour[2]),
      Number(twentyFour[3]),
      twentyFour[4] ? Number(twentyFour[4]) : 0,
    );
  }

  return undefined;
}

function toHour24(hour: number, meridiem: string): number {
  const suffix = meridiem.toLowerCase();
  if (hour === 12) {
    return suffix === "am" ? 0 : 12;
  }
  return suffix === "pm" ? hour + 12 : hour;
}

function farmLocal(
  date: string,
  hour: number,
  minute: number,
  second = 0,
): Date | undefined {
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return undefined;
  }
  return zonedLocalToUtc(date, hour, minute, second);
}
