import assert from "node:assert/strict";
import test from "node:test";
import {
  dateIsInsideReplaceWindow,
  planDailyComponentReplacement,
  planDimensionalReplacement,
} from "./google-analytics.replace";

test("dimensional replacement is scoped to one property and date window", () => {
  const plan = planDimensionalReplacement({
    family: "event",
    propertyId: "310874507",
    from: "2026-09-18",
    to: "2026-09-18",
  });
  assert.equal(plan.kind, "dimensional");
  assert.equal(plan.propertyId, "310874507");
  assert.equal(plan.deleteFrom, "2026-09-18");
  assert.equal(plan.deleteTo, "2026-09-18");
  assert.equal(dateIsInsideReplaceWindow("2026-09-18", plan.deleteFrom, plan.deleteTo), true);
  assert.equal(dateIsInsideReplaceWindow("2026-09-17", plan.deleteFrom, plan.deleteTo), false);
  assert.notEqual(plan.propertyId, "999");
});

test("empty dimensional report still plans a delete for the exact window", () => {
  const plan = planDimensionalReplacement({
    family: "landing_page",
    propertyId: "310874507",
    from: "2026-10-01",
    to: "2026-10-01",
  });
  assert.equal(plan.deleteFrom, plan.deleteTo);
});

test("daily component replacement nulls only owned metrics on missing dates", () => {
  const plan = planDailyComponentReplacement({
    component: "ecommerce_totals",
    propertyId: "310874507",
    from: "2026-09-18",
    to: "2026-09-20",
    incomingFarmDates: ["2026-09-18", "2026-09-20"],
  });
  assert.deepEqual(plan.datesToClear, ["2026-09-19"]);
  assert.deepEqual(plan.incomingDates, ["2026-09-18", "2026-09-20"]);
  assert.equal(plan.nullOwnedMetrics.transactions, null);
  assert.equal(plan.nullOwnedMetrics.purchaseRevenue, null);
  assert.equal("sessions" in plan.nullOwnedMetrics, false);
  assert.equal("eventCount" in plan.nullOwnedMetrics, false);
  assert.equal(plan.snapshotField, "ecommerceTotalsSnapshotId");
});

test("authoritative empty daily component clears every date in the window", () => {
  const plan = planDailyComponentReplacement({
    component: "daily_totals",
    propertyId: "310874507",
    from: "2026-09-18",
    to: "2026-09-18",
    incomingFarmDates: [],
  });
  assert.deepEqual(plan.datesToClear, ["2026-09-18"]);
  assert.equal(plan.nullOwnedMetrics.sessions, null);
  assert.equal(plan.nullOwnedMetrics.eventCount, null);
  assert.equal("transactions" in plan.nullOwnedMetrics, false);
});

test("daily_totals family cannot use dimensional deletion", () => {
  assert.throws(
    () =>
      planDimensionalReplacement({
        family: "daily_totals",
        propertyId: "310874507",
        from: "2026-09-18",
        to: "2026-09-18",
      }),
    /daily_totals_use_component_replacement/,
  );
});
