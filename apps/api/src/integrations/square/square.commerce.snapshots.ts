import {
  FARM_TIME_ZONE,
  instantInUtcRange,
  snapshotWindowInstant,
  type SquareFarmWindow,
} from "./square.range";
import type { SquareUtcRange } from "./square.types";

export type SquareSnapshotRow = {
  id: string;
  externalId: string;
  payload: Record<string, unknown>;
  observedAt: Date;
};

export function pickLatestSnapshots(
  rows: SquareSnapshotRow[],
  entityType: string,
  range: SquareUtcRange,
): SquareSnapshotRow[] {
  const latest = new Map<string, SquareSnapshotRow>();
  for (const row of rows) {
    const windowInstant = snapshotWindowInstant(entityType, row.payload);
    if (!instantInUtcRange(windowInstant, range)) {
      continue;
    }
    const existing = latest.get(row.externalId);
    if (!existing) {
      latest.set(row.externalId, row);
      continue;
    }
    if (row.observedAt.getTime() > existing.observedAt.getTime()) {
      latest.set(row.externalId, row);
      continue;
    }
    if (row.observedAt.getTime() === existing.observedAt.getTime()) {
      const rowUpdated = timestampMs(row.payload.updated_at);
      const existingUpdated = timestampMs(existing.payload.updated_at);
      if (rowUpdated > existingUpdated) {
        latest.set(row.externalId, row);
      }
    }
  }
  return [...latest.values()];
}

export function reconcileRangeLabel(window: SquareFarmWindow): string {
  if ("date" in window) {
    return `${window.date} to ${window.date} (${FARM_TIME_ZONE})`;
  }
  return `${window.from} to ${window.to} (${FARM_TIME_ZONE})`;
}

function timestampMs(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}
