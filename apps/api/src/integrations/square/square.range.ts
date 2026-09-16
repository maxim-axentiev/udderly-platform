import {
  FARM_TIME_ZONE,
  farmDayRange,
  farmInclusiveRange,
} from "../wherewolf/wherewolf.range";
import type { SquareUtcRange } from "./square.types";

export { FARM_TIME_ZONE };

export type SquareFarmWindow = { date: string } | { from: string; to: string };

export function squareFarmUtcRange(window: SquareFarmWindow): SquareUtcRange {
  if ("date" in window) {
    const range = farmDayRange(window.date);
    return { startAt: range.dateBegin, endAt: range.dateEnd };
  }
  const range = farmInclusiveRange(window.from, window.to);
  return { startAt: range.dateBegin, endAt: range.dateEnd };
}

export function parseFarmWindow(
  argv: string[],
): SquareFarmWindow | undefined {
  let date: string | undefined;
  let from: string | undefined;
  let to: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") {
      date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      continue;
    }
    if (arg === "--from") {
      from = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
      continue;
    }
    if (arg === "--to") {
      to = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    }
  }

  const trimmedDate = date?.trim();
  const trimmedFrom = from?.trim();
  const trimmedTo = to?.trim();
  if (trimmedDate && !trimmedFrom && !trimmedTo) {
    return { date: trimmedDate };
  }
  if (!trimmedDate && trimmedFrom && trimmedTo) {
    return { from: trimmedFrom, to: trimmedTo };
  }
  return undefined;
}

export function describeFarmWindow(window: SquareFarmWindow): string[] {
  if ("date" in window) {
    return [`Date: ${window.date} (${FARM_TIME_ZONE})`];
  }
  return [
    `From: ${window.from} (${FARM_TIME_ZONE})`,
    `To: ${window.to} (${FARM_TIME_ZONE}, inclusive)`,
  ];
}

export function instantInUtcRange(
  instant: string | undefined,
  range: SquareUtcRange,
): boolean {
  if (!instant) {
    return false;
  }
  const time = Date.parse(instant);
  if (Number.isNaN(time)) {
    return false;
  }
  return time >= Date.parse(range.startAt) && time < Date.parse(range.endAt);
}

/**
 * Farm-day membership for commerce snapshots.
 * Orders use closed_at (same as sale.occurred_at for completed/canceled).
 * Payments and refunds use created_at.
 */
export function snapshotWindowInstant(
  entityType: string,
  payload: Record<string, unknown>,
): string | undefined {
  if (entityType === "order") {
    return typeof payload.closed_at === "string" ? payload.closed_at : undefined;
  }
  return typeof payload.created_at === "string" ? payload.created_at : undefined;
}
