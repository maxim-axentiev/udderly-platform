import assert from "node:assert/strict";
import test from "node:test";
import { GSC_CANONICAL_SITE_URL } from "./google-search-console.constants";
import { hashCanonicalJson } from "./google-search-console.hash";
import {
  gscReportExternalId,
  gscSiteExternalId,
} from "./google-search-console.identity";
import {
  assertNoSecrets,
  reportSnapshotExternalId,
  sanitizeReportSnapshot,
  sanitizeSite,
} from "./google-search-console.sanitize";
import type { GscCompletedReport } from "./google-search-console.types";

const report: GscCompletedReport = {
  family: "query",
  siteUrl: GSC_CANONICAL_SITE_URL,
  startDate: "2026-09-30",
  endDate: "2026-09-30",
  dataState: "final",
  searchType: "web",
  dimensions: ["date", "query"],
  rows: [
    {
      keys: ["2026-09-30", "goat farm"],
      clicks: 2,
      impressions: 40,
      ctr: 0.05,
      position: 8.1,
    },
  ],
  rowCount: 1,
  requestCount: 1,
  responseAggregationType: "auto",
};

test("site sanitizer keep-lists url and permission only", () => {
  const sanitized = sanitizeSite({
    siteUrl: GSC_CANONICAL_SITE_URL,
    permissionLevel: "siteOwner",
    extraOwnerEmail: "owner@example.com",
  });
  assert.deepEqual(sanitized, {
    siteUrl: GSC_CANONICAL_SITE_URL,
    permissionLevel: "siteOwner",
  });
});

test("report snapshot keep-lists rows and stamps dataState=final", () => {
  const snapshot = sanitizeReportSnapshot(report);
  assert.equal(snapshot.dataState, "final");
  assert.equal(snapshot.searchType, "web");
  assert.deepEqual(snapshot.rows, [
    {
      keys: ["2026-09-30", "goat farm"],
      clicks: 2,
      impressions: 40,
      ctr: 0.05,
      position: 8.1,
    },
  ]);
  assert.equal("accessToken" in snapshot, false);
});

test("report external ids include family, bounds, and final", () => {
  assert.equal(
    reportSnapshotExternalId(GSC_CANONICAL_SITE_URL, "query", "2026-09-30", "2026-10-01"),
    gscReportExternalId(GSC_CANONICAL_SITE_URL, "query", "2026-09-30", "2026-10-01"),
  );
  assert.ok(
    gscReportExternalId(GSC_CANONICAL_SITE_URL, "query", "2026-09-30", "2026-09-30").endsWith(
      ":final",
    ),
  );
  assert.equal(gscSiteExternalId(GSC_CANONICAL_SITE_URL), GSC_CANONICAL_SITE_URL);
});

test("hash is stable for canonical JSON key order", () => {
  assert.equal(
    hashCanonicalJson({ b: 1, a: 2 }),
    hashCanonicalJson({ a: 2, b: 1 }),
  );
});

test("secret-like snapshot fields fail closed", () => {
  assert.throws(() => assertNoSecrets({ refresh_token: "nope" }), /snapshot_contains_secret/);
  assertNoSecrets(sanitizeReportSnapshot(report));
});
