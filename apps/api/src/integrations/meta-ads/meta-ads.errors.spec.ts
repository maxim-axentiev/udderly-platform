import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets } from "./meta-ads.errors";
import { MOCK_ACCESS_TOKEN } from "./meta-ads.fixtures";

test("redacts access tokens from error text", () => {
  const message = redactSecrets(
    `Meta Ads failed: ${MOCK_ACCESS_TOKEN} leaked`,
    [MOCK_ACCESS_TOKEN],
  );
  assert.equal(message.includes(MOCK_ACCESS_TOKEN), false);
  assert.ok(message.includes("[redacted]"));
});
