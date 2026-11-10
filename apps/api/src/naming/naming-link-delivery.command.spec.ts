import assert from "node:assert/strict";
import test from "node:test";
import { validateEnv } from "../config/env";
import {
  deliverResultText,
  parseNamingDeliverCommand,
} from "./naming-link-delivery.command";

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";

test("deliver command accepts a reservation and explicit reissue", () => {
  assert.deepEqual(parseNamingDeliverCommand(["--reservation", RESERVATION_ID]), {
    reservationId: RESERVATION_ID,
    reissue: false,
  });
  assert.equal(
    parseNamingDeliverCommand([`--reservation=${RESERVATION_ID}`, "--reissue"])
      ?.reissue,
    true,
  );
  assert.equal(parseNamingDeliverCommand([]), undefined);
  assert.equal(parseNamingDeliverCommand(["--reservation", "nope"]), undefined);
  assert.equal(parseNamingDeliverCommand(["--reissue"]), undefined);
});

test("delivery results do not include a token or credential", () => {
  const outcomes = [
    "sent",
    "already_sent",
    "already_issued",
    "already_named",
    "in_progress",
    "not_eligible",
    "not_found",
    "not_configured",
    "smtp_failed",
    "uncommitted",
  ] as const;
  for (const outcome of outcomes) {
    const text = deliverResultText(outcome);
    assert.equal(text.includes("smtp.gmail.com"), false);
    assert.equal(/[A-Za-z0-9_-]{43}/.test(text), false);
  }
  assert.match(deliverResultText("uncommitted"), /was not stored/);
  assert.match(deliverResultText("uncommitted"), /will not work/);
  assert.match(deliverResultText("sent"), /not exactly once/);
});

test("partial Gmail settings are rejected without echoing the secret", () => {
  const base = {
    DATABASE_URL: "postgresql://postgres:naming@127.0.0.1:55432/naming",
    REDIS_URL: "redis://127.0.0.1:6379",
  };
  assert.throws(
    () =>
      validateEnv({
        ...base,
        SMTP_USER: "farm@example.com",
        SMTP_APP_PASSWORD: "test-app-password",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("test-app-password"), false);
      assert.equal(error.message.includes("farm@example.com"), false);
      return true;
    },
  );
  const configured = validateEnv({
    ...base,
    SMTP_USER: "farm@example.com",
    SMTP_APP_PASSWORD: "test-app-password",
    SMTP_FROM: "farm@example.com",
    NAMING_PUBLIC_BASE_URL: "https://names.example.com",
  });
  assert.equal(configured.SMTP_USER, "farm@example.com");
  assert.equal(configured.NAMING_PUBLIC_BASE_URL, "https://names.example.com");
});

test("Resend settings are complete or absent and do not echo the key", () => {
  const base = {
    DATABASE_URL: "postgresql://postgres:naming@127.0.0.1:55432/naming",
    REDIS_URL: "redis://127.0.0.1:6379",
  };
  assert.throws(
    () =>
      validateEnv({
        ...base,
        RESEND_API_KEY: "re_test_key",
        RESEND_FROM: "naming@send.example.com",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("re_test_key"), false);
      assert.equal(error.message.includes("naming@send.example.com"), false);
      return true;
    },
  );
  const configured = validateEnv({
    ...base,
    RESEND_API_KEY: "re_test_key",
    RESEND_FROM: "Udderly Naming <naming@send.example.com>",
    RESEND_REPLY_TO: "marketing@example.com",
    NAMING_PUBLIC_BASE_URL: "https://names.example.com",
  });
  assert.equal(configured.RESEND_REPLY_TO, "marketing@example.com");
  assert.equal(configured.SMTP_USER, undefined);
  assert.equal(configured.NAMING_CAMPAIGN_ENABLED, false);
});
