import assert from "node:assert/strict";
import test from "node:test";
import { META_ADS_CANONICAL_ACCOUNT_ID } from "./meta-ads.constants";
import {
  completedInsights,
  mockAccount,
  mockCampaign,
} from "./meta-ads.fixtures";
import { hashCanonicalJson } from "./meta-ads.hash";
import { metaAdsInsightExternalId } from "./meta-ads.identity";
import {
  assertNoSecrets,
  insightSnapshotExternalId,
  sanitizeAccount,
  sanitizeCampaign,
  sanitizeInsightSnapshot,
} from "./meta-ads.sanitize";

test("account sanitizer keep-lists Graph fields and drops tokens", () => {
  const sanitized = sanitizeAccount(mockAccount);
  assert.deepEqual(sanitized, {
    id: META_ADS_CANONICAL_ACCOUNT_ID,
    account_id: "1818645281666685",
    name: "Udderly Ridiculous Farm Life",
    currency: "CAD",
    timezone_name: "America/Toronto",
    account_status: "1",
  });
  assert.equal("access_token" in sanitized, false);
});

test("campaign sanitizer keep-lists structure fields", () => {
  const sanitized = sanitizeCampaign({
    ...mockCampaign,
    targeting: { geo: "CA" },
  });
  assert.equal("targeting" in sanitized, false);
  assert.equal(sanitized.daily_budget, "2500");
});

test("insight snapshot stamps pinned attribution windows", () => {
  const snapshot = sanitizeInsightSnapshot(completedInsights());
  assert.equal(snapshot.attributionWindow, "7d_click,1d_view");
  assert.equal(snapshot.level, "account");
});

test("insight external ids include attribution window", () => {
  assert.equal(
    insightSnapshotExternalId(
      META_ADS_CANONICAL_ACCOUNT_ID,
      "campaign",
      "2026-09-30",
      "2026-10-01",
    ),
    metaAdsInsightExternalId(
      META_ADS_CANONICAL_ACCOUNT_ID,
      "campaign",
      "2026-09-30",
      "2026-10-01",
    ),
  );
  assert.ok(
    metaAdsInsightExternalId(
      META_ADS_CANONICAL_ACCOUNT_ID,
      "ad",
      "2026-09-30",
      "2026-09-30",
    ).endsWith(":7d_click,1d_view"),
  );
});

test("hash is stable for canonical JSON key order", () => {
  assert.equal(
    hashCanonicalJson({ b: 1, a: 2 }),
    hashCanonicalJson({ a: 2, b: 1 }),
  );
});

test("secret-like snapshot fields fail closed", () => {
  assert.throws(() => assertNoSecrets(mockAccount), /snapshot_contains_secret/);
  assertNoSecrets(sanitizeAccount(mockAccount));
  assertNoSecrets(sanitizeInsightSnapshot(completedInsights()));
});
