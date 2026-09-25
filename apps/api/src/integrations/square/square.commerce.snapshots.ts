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
    if (snapshotIsNewer(row, existing)) {
      latest.set(row.externalId, row);
    }
  }
  return [...latest.values()];
}

export function pickLatestSnapshotByExternalId(
  rows: SquareSnapshotRow[],
): SquareSnapshotRow | undefined {
  let latest: SquareSnapshotRow | undefined;
  for (const row of rows) {
    if (!latest || snapshotIsNewer(row, latest)) {
      latest = row;
    }
  }
  return latest;
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

function snapshotVersion(payload: Record<string, unknown>): number {
  return typeof payload.version === "number" ? payload.version : 0;
}

function snapshotIsNewer(
  candidate: SquareSnapshotRow,
  incumbent: SquareSnapshotRow,
): boolean {
  if (candidate.observedAt.getTime() !== incumbent.observedAt.getTime()) {
    return candidate.observedAt.getTime() > incumbent.observedAt.getTime();
  }
  const candidateUpdated = timestampMs(candidate.payload.updated_at);
  const incumbentUpdated = timestampMs(incumbent.payload.updated_at);
  if (candidateUpdated !== incumbentUpdated) {
    return candidateUpdated > incumbentUpdated;
  }
  return snapshotVersion(candidate.payload) > snapshotVersion(incumbent.payload);
}
