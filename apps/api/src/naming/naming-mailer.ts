import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { EnvService } from "../config/env.service";

export const GMAIL_SMTP_HOST = "smtp.gmail.com";
export const GMAIL_SMTP_PORT = 465;
export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const RESEND_ATTEMPTS = 3;
const RESEND_TIMEOUT_MS = 10_000;

export type NamingSmtpAuth = {
  user: string;
  appPassword: string;
};

export type NamingEmail = {
  reservationId: string;
  to: string;
  subject: string;
  text: string;
  scope?: "naming-link" | "naming-notice" | "naming-certificate";
};

export type NamingMailConfig = {
  namingResend?: { apiKey: string; from: string; replyTo: string };
  namingSmtp?: { user: string; appPassword: string; from: string };
};

type MailDeps = {
  fetchImpl?: typeof fetch;
  createSmtpTransport?: typeof createTransport;
  sleep?: (ms: number) => Promise<void>;
};

export function gmailTransportOptions(
  auth: NamingSmtpAuth,
): SMTPTransport.Options {
  return {
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    secure: true,
    auth: {
      user: auth.user,
      pass: auth.appPassword,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/**
 * Key for one exact Resend body. A new naming token changes the text, so the
 * key changes with it. An HTTP retry of the same body reuses this key.
 * The plaintext token is not part of the key.
 */
export function resendIdempotencyKey(input: {
  reservationId: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  scope?: NamingEmail["scope"];
}): string {
  const material = [
    input.scope ?? "naming-link",
    input.reservationId,
    input.from,
    input.to,
    input.replyTo,
    input.subject,
    input.text,
  ].join("\n");
  const digest = createHash("sha256").update(material).digest("hex");
  return `${input.scope ?? "naming-link"}/${digest}`;
}

export function selectNamingTransport(
  config: NamingMailConfig,
): "resend" | "smtp" | undefined {
  if (config.namingResend) {
    return "resend";
  }
  if (config.namingSmtp) {
    return "smtp";
  }
  return undefined;
}

/**
 * Sends one plain-text naming email.
 * Resend is used when configured. Gmail SMTP is the local fallback.
 * Secrets and message text are not logged.
 */
@Injectable()
export class NamingMailer {
  constructor(@Inject(EnvService) private readonly env: EnvService) {}

  async send(message: NamingEmail): Promise<void> {
    await deliverNamingEmail(this.env, message);
  }
}

export async function deliverNamingEmail(
  config: NamingMailConfig,
  message: NamingEmail,
  deps: MailDeps = {},
): Promise<void> {
  const transport = selectNamingTransport(config);
  if (transport === "resend" && config.namingResend) {
    await sendResendEmail(config.namingResend, message, deps);
    return;
  }
  if (transport === "smtp" && config.namingSmtp) {
    await sendGmailSmtp(
      config.namingSmtp,
      message,
      deps.createSmtpTransport ?? createTransport,
    );
    return;
  }
  throw new Error("naming_mail_not_configured");
}

export async function sendResendEmail(
  resend: { apiKey: string; from: string; replyTo: string },
  message: NamingEmail,
  deps: MailDeps = {},
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const body = {
    from: resend.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    reply_to: resend.replyTo,
  };
  const idempotencyKey = resendIdempotencyKey({
    reservationId: message.reservationId,
    from: body.from,
    to: body.to,
    replyTo: body.reply_to,
    subject: body.subject,
    text: body.text,
    scope: message.scope,
  });
  const payload = JSON.stringify(body);

  for (let attempt = 1; attempt <= RESEND_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(RESEND_EMAILS_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${resend.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: payload,
      });
    } catch {
      if (attempt === RESEND_ATTEMPTS) {
        throw new Error("naming_resend_unavailable");
      }
      await sleep(retryDelayMs(attempt, null));
      continue;
    }

    const retryAfter = response.headers.get("retry-after");
    await response.body?.cancel();
    if (response.ok) {
      return;
    }
    if (!retryableStatus(response.status) || attempt === RESEND_ATTEMPTS) {
      throw new Error(`naming_resend_${response.status}`);
    }
    await sleep(retryDelayMs(attempt, retryAfter));
  }
}

async function sendGmailSmtp(
  smtp: { user: string; appPassword: string; from: string },
  message: NamingEmail,
  create: typeof createTransport,
): Promise<void> {
  const transport: Transporter<SMTPTransport.SentMessageInfo> = create(
    gmailTransportOptions(smtp),
  );
  try {
    await transport.sendMail({
      from: smtp.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  } finally {
    transport.close();
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const headerSeconds = Number(retryAfter);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
    return Math.min(headerSeconds * 1000, 1000);
  }
  return Math.min(200 * 2 ** (attempt - 1), 1000);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
