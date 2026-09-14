export class WherewolfApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "WherewolfApiError";
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
