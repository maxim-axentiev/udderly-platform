import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMailchimpLockError,
  redactSecrets,
} from "./mailchimp.errors";
import { MOCK_MAILCHIMP_API_KEY } from "./mailchimp.fixtures";

test("redacts API keys from error text", () => {
  assert.equal(
    redactSecrets(`bad ${MOCK_MAILCHIMP_API_KEY}`, [MOCK_MAILCHIMP_API_KEY]),
    "bad [redacted]",
  );
});

test("busy import lock maps to a dedicated already-running error", () => {
  assert.equal(
    formatMailchimpLockError("advisory_lock_busy"),
    "mailchimp_import_already_running",
  );
});
