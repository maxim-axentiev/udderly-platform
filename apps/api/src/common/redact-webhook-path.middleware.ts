import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

export function redactFareharborWebhookPath(value: string): string {
  return value.replace(
    /(\/webhooks\/fareharbor\/)[^/?#]+/gi,
    "$1[redacted]",
  );
}

@Injectable()
export class RedactWebhookPathMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const originalUrl = req.originalUrl;
    if (!originalUrl.toLowerCase().includes("/webhooks/fareharbor/")) {
      next();
      return;
    }

    const redactedOriginalUrl = redactFareharborWebhookPath(originalUrl);
    Object.defineProperty(req, "originalUrl", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: redactedOriginalUrl,
    });
    req.url = redactFareharborWebhookPath(req.url);

    next();
  }
}
