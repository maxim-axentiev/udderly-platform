import type { WherewolfUtcRange } from "./wherewolf.types";

export function recentUtcRange(days: number): WherewolfUtcRange {
  const dateEnd = new Date();
  const dateBegin = new Date(dateEnd.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    dateBegin: dateBegin.toISOString(),
    dateEnd: dateEnd.toISOString(),
  };
}
