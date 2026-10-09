import { loadEnvFiles } from "../../config/load-env";
import { EnvService } from "../../config/env.service";
import { MailchimpClient } from "./mailchimp.client";
import { sanitizeAccount } from "./mailchimp.sanitize";

async function main(): Promise<void> {
  loadEnvFiles();
  const env = new EnvService();
  if (!env.mailchimp) {
    throw new Error("mailchimp_not_configured");
  }
  const client = new MailchimpClient({ apiKey: env.mailchimp.apiKey });
  const raw = await client.getAccount();
  const types = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value === null ? "null" : typeof value]),
  );
  const timezone = raw.account_timezone ?? raw.timezone;
  console.log(`account_keys=${JSON.stringify(types)}`);
  console.log(`timezone_type=${timezone === null ? "null" : typeof timezone}`);
  if (typeof timezone === "string") {
    console.log(`timezone_value=${timezone}`);
  } else if (timezone && typeof timezone === "object") {
    console.log(
      `timezone_object_keys=${JSON.stringify(Object.keys(timezone as object))}`,
    );
  }
  const sanitized = sanitizeAccount(raw);
  console.log(`sanitized_keys=${JSON.stringify(Object.keys(sanitized).sort())}`);
  console.log(`sanitized_has_timezone=${typeof sanitized.timezone === "string"}`);
  console.log(`sanitized_has_account_id=${typeof sanitized.account_id === "string"}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
