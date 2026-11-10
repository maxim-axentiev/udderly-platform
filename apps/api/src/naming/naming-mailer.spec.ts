import assert from "node:assert/strict";
import test from "node:test";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { createNamingToken } from "./naming-gift-card";
import { namingLinkMessage, namingLinkUrl } from "./naming-link-delivery";
import {
  RESEND_EMAILS_URL,
  deliverNamingEmail,
  resendIdempotencyKey,
  selectNamingTransport,
  type NamingEmail,
} from "./naming-mailer";

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY = "re_test_key";
const FROM = "naming@send.example.com";
const REPLY_TO = "marketing@example.com";

const resend = { apiKey: API_KEY, from: FROM, replyTo: REPLY_TO };
const smtp = {
  user: "farm@example.com",
  appPassword: "test-app-password",
  from: "farm@example.com",
};

test("Resend is preferred and SMTP remains the fallback", () => {
  assert.equal(selectNamingTransport({ namingResend: resend, namingSmtp: smtp }), "resend");
  assert.equal(selectNamingTransport({ namingSmtp: smtp }), "smtp");
  assert.equal(selectNamingTransport({}), undefined);
});

test("a new naming token gets a new idempotency key", () => {
  const first = emailFor(createNamingToken().token);
  const second = emailFor(createNamingToken().token);
  const firstKey = keyFor(first);
  const secondKey = keyFor(second);
  assert.notEqual(first.text, second.text);
  assert.notEqual(firstKey, secondKey);
  assert.equal(firstKey, keyFor(first));
  assert.equal(firstKey.includes(tokenFrom(first.text)), false);
  assert.equal(secondKey.includes(tokenFrom(second.text)), false);
});

test("Resend accepts one message and retries the same body", async () => {
  const message = emailFor(createNamingToken().token);
  const calls: { url: string; init: RequestInit }[] = [];
  let remainingFailures = 1;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "2" },
      });
    }
    return new Response(JSON.stringify({ id: "email_test" }), { status: 200 });
  };

  await deliverNamingEmail(
    { namingResend: resend, namingSmtp: smtp },
    message,
    { fetchImpl, sleep: async () => {}, createSmtpTransport: forbiddenSmtp },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, RESEND_EMAILS_URL);
  const firstHeaders = new Headers(calls[0]?.init.headers);
  const secondHeaders = new Headers(calls[1]?.init.headers);
  assert.equal(firstHeaders.get("authorization"), `Bearer ${API_KEY}`);
  assert.equal(firstHeaders.get("idempotency-key"), secondHeaders.get("idempotency-key"));
  assert.equal(firstHeaders.get("idempotency-key"), keyFor(message));
  assert.equal(calls[0]?.init.body, calls[1]?.init.body);
  const body = JSON.parse(String(calls[0]?.init.body)) as {
    from: string;
    reply_to: string;
    text: string;
  };
  assert.equal(body.from, FROM);
  assert.equal(body.reply_to, REPLY_TO);
  assert.equal(body.text, message.text);
});

test("Resend does not retry a rejected message or a changed body", async () => {
  const message = emailFor(createNamingToken().token);
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response("invalid", { status: 422 });
  };
  await assert.rejects(
    () =>
      deliverNamingEmail({ namingResend: resend }, message, {
        fetchImpl,
        sleep: async () => {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "naming_resend_422");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes(tokenFrom(message.text)), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("a dropped Resend connection is retried and then reported without the secret", async () => {
  const message = emailFor(createNamingToken().token);
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    throw new Error(`connect failed ${API_KEY}`);
  };
  await assert.rejects(
    () =>
      deliverNamingEmail({ namingResend: resend }, message, {
        fetchImpl,
        sleep: async () => {},
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "naming_resend_unavailable");
      assert.equal(error.message.includes(API_KEY), false);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("SMTP sends when Resend is unset", async () => {
  const message = emailFor(createNamingToken().token);
  const sent: SMTPTransport.Options[] = [];
  const closed = { value: false };
  const createSmtpTransport = ((options: SMTPTransport.Options) => {
    sent.push(options);
    return {
      sendMail: async (mail: { from?: string; to?: string; text?: string }) => {
        assert.equal(mail.from, smtp.from);
        assert.equal(mail.to, message.to);
        assert.equal(mail.text, message.text);
        return { messageId: "smtp-test" };
      },
      close: () => {
        closed.value = true;
      },
    } as Transporter<SMTPTransport.SentMessageInfo>;
  }) as typeof import("nodemailer").createTransport;

  await deliverNamingEmail({ namingSmtp: smtp }, message, { createSmtpTransport });
  assert.equal(sent[0]?.host, "smtp.gmail.com");
  assert.equal(sent[0]?.port, 465);
  assert.equal(sent[0]?.auth?.user, smtp.user);
  assert.equal(sent[0]?.auth?.pass, smtp.appPassword);
  assert.equal(closed.value, true);
});

test("neither transport sends", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response(null, { status: 200 });
  };
  await assert.rejects(
    () =>
      deliverNamingEmail({}, emailFor(createNamingToken().token), {
        fetchImpl,
        createSmtpTransport: forbiddenSmtp,
      }),
    /naming_mail_not_configured/,
  );
  assert.equal(called, false);
});

function emailFor(token: string): NamingEmail {
  const message = namingLinkMessage(
    "Wheelbarrow",
    namingLinkUrl("https://names.example.com", token),
  );
  return {
    reservationId: RESERVATION_ID,
    to: "purchaser@example.invalid",
    subject: message.subject,
    text: message.text,
  };
}

function keyFor(message: NamingEmail): string {
  return resendIdempotencyKey({
    reservationId: message.reservationId,
    from: FROM,
    to: message.to,
    replyTo: REPLY_TO,
    subject: message.subject,
    text: message.text,
  });
}

function tokenFrom(text: string): string {
  const matched = text.match(/\/name\/([A-Za-z0-9_-]{43})/);
  assert.ok(matched?.[1]);
  return matched[1];
}

function forbiddenSmtp(): never {
  throw new Error("SMTP was selected");
}
