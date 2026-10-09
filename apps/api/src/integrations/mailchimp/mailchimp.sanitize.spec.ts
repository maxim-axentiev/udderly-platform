import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonicalJson } from "./mailchimp.hash";
import {
  mockAccount,
  mockAudience,
  mockCampaign,
  mockClick,
  mockReport,
} from "./mailchimp.fixtures";
import {
  assertNoPii,
  assertNoSecrets,
  sanitizeAccount,
  sanitizeAudience,
  sanitizeCampaign,
  sanitizeCampaignReport,
  sanitizeClickDetail,
} from "./mailchimp.sanitize";

test("account sanitizer maps account_timezone and drops owner PII", () => {
  const sanitized = sanitizeAccount({
    ...mockAccount,
    account_timezone: "America/Toronto",
  });
  assert.deepEqual(sanitized, {
    account_id: "acct123",
    account_name: "Udderly Ridiculous Farm Life",
    timezone: "America/Toronto",
  });
  assert.equal("account_timezone" in sanitized, false);
  assert.equal("email" in sanitized, false);
  assert.equal("first_name" in sanitized, false);
  assertNoPii(sanitized);
  assertNoSecrets(sanitized);
});

test("audience sanitizer drops members arrays", () => {
  const sanitized = sanitizeAudience(mockAudience);
  assert.equal("members" in sanitized, false);
  assert.equal((sanitized.stats as { member_count: number }).member_count, 120);
  assertNoPii(sanitized);
});

test("raw audience with members fails closed", () => {
  assert.throws(() => assertNoPii(mockAudience), /snapshot_contains_pii/);
});

test("campaign sanitizer keep-lists settings and GA tracking string", () => {
  const sanitized = sanitizeCampaign({
    ...mockCampaign,
    recipients: { ...mockCampaign.recipients as object, emails: ["a@b.c"] },
  });
  assert.equal("emails" in (sanitized.recipients as object), false);
  assert.equal(
    (sanitized.tracking as { google_analytics: string }).google_analytics,
    "mc-september-farm-news",
  );
});

test("campaign report drops share password", () => {
  const sanitized = sanitizeCampaignReport(mockReport);
  assert.equal("share_report" in sanitized, false);
  assertNoPii(sanitized);
});

test("click sanitizer keeps URL without userinfo", () => {
  const sanitized = sanitizeClickDetail({
    ...mockClick,
    url: "https://user:pass@udderlyridiculousfarmlife.com/visit",
  });
  assert.equal(sanitized.url, "https://udderlyridiculousfarmlife.com/visit");
});

test("hash is stable for canonical JSON key order", () => {
  assert.equal(
    hashCanonicalJson({ b: 1, a: 2 }),
    hashCanonicalJson({ a: 2, b: 1 }),
  );
});
