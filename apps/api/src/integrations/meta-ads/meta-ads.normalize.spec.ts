import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInsightPayload } from "./meta-ads.normalize";

test("converts spend to integer CAD cents and keeps daily grain", () => {
  const facts = normalizeInsightPayload({
    level: "account",
    attributionWindow: "7d_click,1d_view",
    rows: [
      {
        dateStart: "2026-09-30",
        dateStop: "2026-09-30",
        objectId: "1818645281666685",
        spend: "12.34",
        impressions: "100",
        clicks: "4",
      },
    ],
  });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].metricDate, "2026-09-30");
  assert.equal(facts[0].spendAmount, 1234);
  assert.equal(facts[0].currency, "CAD");
  assert.equal(facts[0].attributionWindow, "7d_click,1d_view");
});

test("does not fabricate rows from an empty report", () => {
  const facts = normalizeInsightPayload({
    level: "campaign",
    attributionWindow: "7d_click,1d_view",
    rows: [],
  });
  assert.deepEqual(facts, []);
});

test("rejects non-daily ranges, wrong attribution, and duplicate grains", () => {
  assert.throws(
    () =>
      normalizeInsightPayload({
        level: "campaign",
        attributionWindow: "1d_click,1d_view",
        rows: [],
      }),
    /meta_ads_attribution_window_mismatch/,
  );
  assert.throws(
    () =>
      normalizeInsightPayload({
        level: "campaign",
        attributionWindow: "7d_click,1d_view",
        rows: [
          {
            dateStart: "2026-09-30",
            dateStop: "2026-10-01",
            objectId: "1",
            spend: "1.00",
            impressions: "1",
            clicks: "0",
          },
        ],
      }),
    /meta_ads_insight_not_daily/,
  );
  assert.throws(
    () =>
      normalizeInsightPayload({
        level: "campaign",
        attributionWindow: "7d_click,1d_view",
        rows: [
          {
            dateStart: "2026-09-30",
            dateStop: "2026-09-30",
            objectId: "1",
            spend: "1.00",
            impressions: "1",
            clicks: "0",
          },
          {
            dateStart: "2026-09-30",
            dateStop: "2026-09-30",
            objectId: "1",
            spend: "2.00",
            impressions: "2",
            clicks: "1",
          },
        ],
      }),
    /duplicate_dimension_key/,
  );
});
