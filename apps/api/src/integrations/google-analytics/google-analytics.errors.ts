export class GoogleAnalyticsApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "GoogleAnalyticsApiError";
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
