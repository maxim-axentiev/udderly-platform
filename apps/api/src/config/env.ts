import { FareharborTierConfigError, parseFareharborTierCheckouts } from "@udderly/shared";
import { z } from "zod";
import { loadEnvFiles } from "./load-env";

const optionalTrimmedSecret = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_LISTEN_HOST: z.string().min(1).default("127.0.0.1"),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL is required"),
  REDIS_URL: z
    .string({ required_error: "REDIS_URL is required" })
    .min(1, "REDIS_URL is required"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  WHEREWOLF_API_KEY: optionalTrimmedSecret,
  WHEREWOLF_APP_ID: optionalTrimmedSecret,
  FAREHARBOR_WEBHOOK_SECRET: optionalTrimmedSecret,
  SQUARE_ACCESS_TOKEN: optionalTrimmedSecret,
  SQUARE_APPLICATION_ID: optionalTrimmedSecret,
  SQUARE_LOCATION_ID: optionalTrimmedSecret,
  GOOGLE_ANALYTICS_PROPERTY_ID: optionalTrimmedSecret,
  GOOGLE_ANALYTICS_CLIENT_ID: optionalTrimmedSecret,
  GOOGLE_ANALYTICS_CLIENT_SECRET: optionalTrimmedSecret,
  GOOGLE_ANALYTICS_REFRESH_TOKEN: optionalTrimmedSecret,
  GOOGLE_SEARCH_CONSOLE_SITE_URL: optionalTrimmedSecret,
  GOOGLE_SEARCH_CONSOLE_CLIENT_ID: optionalTrimmedSecret,
  GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: optionalTrimmedSecret,
  GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: optionalTrimmedSecret,
  META_ADS_ACCOUNT_ID: optionalTrimmedSecret,
  META_ADS_ACCESS_TOKEN: optionalTrimmedSecret,
  MAILCHIMP_API_KEY: optionalTrimmedSecret,
  RESEND_API_KEY: optionalTrimmedSecret,
  RESEND_FROM: optionalTrimmedSecret,
  RESEND_REPLY_TO: optionalTrimmedSecret,
  SMTP_USER: optionalTrimmedSecret,
  SMTP_APP_PASSWORD: optionalTrimmedSecret,
  SMTP_FROM: optionalTrimmedSecret,
  NAMING_PUBLIC_BASE_URL: z.preprocess((value) => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().url().optional()),
  NAMING_ADMIN_PASSWORD: optionalBoundedSecret(12),
  NAMING_ADMIN_SESSION_SECRET: optionalBoundedSecret(32),
  NAMING_PHOTO_DIR: optionalTrimmedSecret,
  NAMING_FAREHARBOR_TIERS: optionalTrimmedSecret,
  NAMING_CAMPAIGN_ENABLED: z
    .preprocess((value) => {
      if (value === undefined || value === "") {
        return "false";
      }
      return value;
    }, z.enum(["true", "false"]))
    .transform((value) => value === "true"),
}).superRefine((value, context) => {
  requireTogether(
    context,
    [value.NAMING_ADMIN_PASSWORD, value.NAMING_ADMIN_SESSION_SECRET],
    "NAMING_ADMIN_PASSWORD",
    "NAMING_ADMIN_PASSWORD and NAMING_ADMIN_SESSION_SECRET must be set together",
  );
  requireTogether(
    context,
    [value.RESEND_API_KEY, value.RESEND_FROM, value.RESEND_REPLY_TO],
    "RESEND_API_KEY",
    "RESEND_API_KEY, RESEND_FROM, and RESEND_REPLY_TO must be set together",
  );
  requireTogether(
    context,
    [value.SMTP_USER, value.SMTP_APP_PASSWORD, value.SMTP_FROM],
    "SMTP_USER",
    "SMTP_USER, SMTP_APP_PASSWORD, and SMTP_FROM must be set together",
  );
  if (value.RESEND_FROM && !isSenderAddress(value.RESEND_FROM)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RESEND_FROM"],
      message: "RESEND_FROM must be an email address on the verified domain",
    });
  }
  try {
    parseFareharborTierCheckouts(value.NAMING_FAREHARBOR_TIERS);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NAMING_FAREHARBOR_TIERS"],
      message:
        error instanceof FareharborTierConfigError
          ? error.message
          : "NAMING_FAREHARBOR_TIERS is not a valid tier mapping",
    });
  }
  if (value.RESEND_REPLY_TO && !isMailbox(value.RESEND_REPLY_TO)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RESEND_REPLY_TO"],
      message: "RESEND_REPLY_TO must be an email address",
    });
  }
});

function optionalBoundedSecret(minLength: number) {
  return z.preprocess((value) => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().min(minLength).optional());
}

const PLAIN_MAILBOX = /^[^\s@<>"]+@[^\s@<>"]+$/;
const NAMED_MAILBOX = /^[^\r\n<>"]{1,80}<[^\s@<>"]+@[^\s@<>"]+>$/;

function requireTogether(
  context: z.RefinementCtx,
  values: Array<string | undefined>,
  path: string,
  message: string,
): void {
  const present = values.filter((item) => item !== undefined).length;
  if (present !== 0 && present !== values.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [path],
      message,
    });
  }
}

function isMailbox(value: string): boolean {
  return PLAIN_MAILBOX.test(value);
}

function isSenderAddress(value: string): boolean {
  return isMailbox(value) || NAMED_MAILBOX.test(value);
}

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  loadEnvFiles();

  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Invalid environment variables. Copy \`.env.example\` to \`.env\` in the repository root.\n${details}`,
    );
  }

  return parsed.data;
}
