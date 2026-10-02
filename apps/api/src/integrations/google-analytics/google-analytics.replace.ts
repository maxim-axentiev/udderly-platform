import {
  DAILY_COMPONENT_SNAPSHOT_FIELD,
  dailyComponentNullOwnedMetrics,
  isGaDailyComponentId,
  type GaDailyComponentId,
} from "./google-analytics.daily";
import { farmDatesInclusive } from "./google-analytics.range";
import type { GaCanonicalFamily } from "./google-analytics.reports";

export type GaDimensionalReplacePlan = {
  kind: "dimensional";
  family: GaCanonicalFamily;
  propertyId: string;
  deleteFrom: string;
  deleteTo: string;
};

export type GaDailyComponentReplacePlan = {
  kind: "daily_component";
  component: GaDailyComponentId;
  propertyId: string;
  from: string;
  to: string;
  incomingDates: string[];
  datesToClear: string[];
  nullOwnedMetrics: Record<string, null>;
  snapshotField: "siteTotalsSnapshotId" | "engagementSnapshotId" | "ecommerceTotalsSnapshotId";
};

export function planDimensionalReplacement(input: {
  family: GaCanonicalFamily;
  propertyId: string;
  from: string;
  to: string;
}): GaDimensionalReplacePlan {
  if (input.family === "daily_totals") {
    throw new Error("daily_totals_use_component_replacement");
  }
  return {
    kind: "dimensional",
    family: input.family,
    propertyId: input.propertyId,
    deleteFrom: input.from,
    deleteTo: input.to,
  };
}

export function planDailyComponentReplacement(input: {
  component: GaDailyComponentId;
  propertyId: string;
  from: string;
  to: string;
  incomingFarmDates: readonly string[];
}): GaDailyComponentReplacePlan {
  if (!isGaDailyComponentId(input.component)) {
    throw new Error("unknown_daily_component");
  }
  const incomingDates = [...new Set(input.incomingFarmDates)];
  const incoming = new Set(incomingDates);
  const datesToClear = farmDatesInclusive(input.from, input.to).filter(
    (date) => !incoming.has(date),
  );
  return {
    kind: "daily_component",
    component: input.component,
    propertyId: input.propertyId,
    from: input.from,
    to: input.to,
    incomingDates,
    datesToClear,
    nullOwnedMetrics: dailyComponentNullOwnedMetrics(input.component),
    snapshotField: DAILY_COMPONENT_SNAPSHOT_FIELD[input.component],
  };
}

export function dateIsInsideReplaceWindow(
  date: string,
  from: string,
  to: string,
): boolean {
  return date >= from && date <= to;
}
