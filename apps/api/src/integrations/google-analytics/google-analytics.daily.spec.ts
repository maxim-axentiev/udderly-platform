import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDailyComponentMetrics,
  dailyComponentNullOwnedMetrics,
  dailyTotalsComponentsComplete,
} from "./google-analytics.daily";

test("rerunning one daily component preserves metrics owned by another", () => {
  const afterSite = applyDailyComponentMetrics(
    {},
    "daily_totals",
    { sessions: "10", eventCount: "20" },
  );
  const afterEcommerce = applyDailyComponentMetrics(afterSite, "ecommerce_totals", {
    ecommercePurchases: "2",
    purchaseRevenue: "40",
  });
  const rerunEcommerce = applyDailyComponentMetrics(afterEcommerce, "ecommerce_totals", {
    ecommercePurchases: "3",
  });
  assert.equal(rerunEcommerce.sessions, "10");
  assert.equal(rerunEcommerce.eventCount, "20");
  assert.equal(rerunEcommerce.ecommercePurchases, "3");
  assert.equal(rerunEcommerce.purchaseRevenue, "40");
});

test("missing ecommerce stays undefined, not zero", () => {
  const row = applyDailyComponentMetrics({}, "daily_totals", { sessions: "5" });
  assert.equal(row.sessions, "5");
  assert.equal(row.ecommercePurchases, undefined);
});

test("nulling ecommerce owned metrics does not list site totals keys", () => {
  const cleared = dailyComponentNullOwnedMetrics("ecommerce_totals");
  assert.equal(cleared.transactions, null);
  assert.equal("sessions" in cleared, false);
});

test("a partial daily row is not complete", () => {
  assert.equal(
    dailyTotalsComponentsComplete({
      siteTotalsSnapshotId: "site",
      engagementSnapshotId: null,
      ecommerceTotalsSnapshotId: "ecom",
    }),
    false,
  );
  assert.equal(
    dailyTotalsComponentsComplete({
      siteTotalsSnapshotId: "site",
      engagementSnapshotId: "eng",
      ecommerceTotalsSnapshotId: "ecom",
    }),
    true,
  );
});
