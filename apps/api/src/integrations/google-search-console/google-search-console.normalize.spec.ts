import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReportPayload } from "./google-search-console.normalize";

test("preserves Google CTR and position instead of deriving them", () => {
  const facts = normalizeReportPayload({
    family: "daily_totals",
    dataState: "final",
    searchType: "web",
    dimensions: ["date"],
    rows: [
      {
        keys: ["2026-09-30"],
        clicks: 10,
        impressions: 100,
        ctr: 0.111,
        position: 7.25,
      },
    ],
  });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].gscDate, "2026-09-30");
  assert.equal(facts[0].metrics.clicks, "10");
  assert.equal(facts[0].metrics.impressions, "100");
  assert.equal(facts[0].metrics.ctr, "0.111");
  assert.equal(facts[0].metrics.position, "7.25");
  assert.notEqual(facts[0].metrics.ctr, "0.1");
});

test("keeps query and page dimension values", () => {
  const facts = normalizeReportPayload({
    family: "query",
    dataState: "final",
    searchType: "web",
    dimensions: ["date", "query"],
    rows: [
      {
        keys: ["2026-09-30", "udderly farm"],
        clicks: 1,
        impressions: 8,
        ctr: 0.125,
        position: 3,
      },
    ],
  });
  assert.equal(facts[0].dimensions.query, "udderly farm");
});

test("search appearance takes gscDate from the per-day request, not a date dimension", () => {
  const facts = normalizeReportPayload({
    family: "search_appearance",
    dataState: "final",
    searchType: "web",
    dimensions: ["searchAppearance"],
    startDate: "2026-09-30",
    endDate: "2026-10-01",
    rows: [
      {
        keys: ["AMP_BLUE_LINK"],
        clicks: 1,
        impressions: 4,
        ctr: 0.25,
        position: 2,
        gscDate: "2026-09-30",
      },
    ],
  });
  assert.equal(facts[0].gscDate, "2026-09-30");
  assert.equal(facts[0].dimensions.searchAppearance, "AMP_BLUE_LINK");
});

test("does not fabricate rows from an empty report", () => {
  const facts = normalizeReportPayload({
    family: "country",
    dataState: "final",
    searchType: "web",
    dimensions: ["date", "country"],
    rows: [],
  });
  assert.deepEqual(facts, []);
});

test("rejects non-final snapshots and duplicate keys", () => {
  assert.throws(
    () =>
      normalizeReportPayload({
        family: "daily_totals",
        dataState: "all",
        searchType: "web",
        dimensions: ["date"],
        rows: [],
      }),
    /google_search_console_non_final_data/,
  );
  assert.throws(
    () =>
      normalizeReportPayload({
        family: "daily_totals",
        dataState: "final",
        searchType: "web",
        dimensions: ["date"],
        rows: [
          { keys: ["2026-09-30"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
          { keys: ["2026-09-30"], clicks: 2, impressions: 2, ctr: 1, position: 1 },
        ],
      }),
    /duplicate_dimension_key/,
  );
});
