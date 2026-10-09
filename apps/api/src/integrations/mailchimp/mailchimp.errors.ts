export class MailchimpApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MailchimpApiError";
  }
}

export function redactSecrets(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) {
      return current;
    }
    return current.split(secret).join("[redacted]");
  }, text);
}

export const MAILCHIMP_IMPORT_ALREADY_RUNNING = "mailchimp_import_already_running";

export function formatMailchimpLockError(message: string): string {
  return message === "advisory_lock_busy" ? MAILCHIMP_IMPORT_ALREADY_RUNNING : message;
}
