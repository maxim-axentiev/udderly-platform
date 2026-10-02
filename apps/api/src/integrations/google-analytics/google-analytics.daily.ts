export type GaDailyComponentId =
  | "daily_totals"
  | "daily_engagement"
  | "ecommerce_totals";

export const DAILY_COMPONENT_METRICS: Record<
  GaDailyComponentId,
  readonly string[]
> = {
  daily_totals: [
    "sessions",
    "activeUsers",
    "newUsers",
    "engagedSessions",
    "engagementRate",
    "bounceRate",
    "averageSessionDuration",
    "eventCount",
    "screenPageViews",
    "keyEvents",
  ],
  daily_engagement: ["userEngagementDuration", "totalUsers"],
  ecommerce_totals: [
    "ecommercePurchases",
    "transactions",
    "purchaseRevenue",
    "itemsPurchased",
    "addToCarts",
  ],
};

export const DAILY_COMPONENT_SNAPSHOT_FIELD: Record<
  GaDailyComponentId,
  "siteTotalsSnapshotId" | "engagementSnapshotId" | "ecommerceTotalsSnapshotId"
> = {
  daily_totals: "siteTotalsSnapshotId",
  daily_engagement: "engagementSnapshotId",
  ecommerce_totals: "ecommerceTotalsSnapshotId",
};

export type DailyTotalComponents = {
  siteTotalsSnapshotId?: string | null;
  engagementSnapshotId?: string | null;
  ecommerceTotalsSnapshotId?: string | null;
};

export function isGaDailyComponentId(id: string): id is GaDailyComponentId {
  return id in DAILY_COMPONENT_METRICS;
}

export function applyDailyComponentMetrics(
  existing: Record<string, string | undefined>,
  component: GaDailyComponentId,
  incoming: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const next = { ...existing };
  for (const key of DAILY_COMPONENT_METRICS[component]) {
    if (incoming[key] !== undefined) {
      next[key] = incoming[key];
    }
  }
  return next;
}

export function dailyComponentOwnedKeys(component: GaDailyComponentId): string[] {
  return [...DAILY_COMPONENT_METRICS[component]];
}

export function dailyTotalsComponentsComplete(row: DailyTotalComponents): boolean {
  return Boolean(
    row.siteTotalsSnapshotId &&
      row.engagementSnapshotId &&
      row.ecommerceTotalsSnapshotId,
  );
}
