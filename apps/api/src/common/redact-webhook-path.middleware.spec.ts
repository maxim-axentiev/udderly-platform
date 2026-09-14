import assert from "node:assert/strict";
import test from "node:test";
import { redactFareharborWebhookPath } from "./redact-webhook-path.middleware";

test("redacts the FareHarbor webhook secret in the request path", () => {
  assert.equal(
    redactFareharborWebhookPath("/webhooks/fareharbor/super-secret-value?x=1"),
    "/webhooks/fareharbor/[redacted]?x=1",
  );
});

test("leaves unrelated paths unchanged", () => {
  assert.equal(redactFareharborWebhookPath("/health"), "/health");
});
