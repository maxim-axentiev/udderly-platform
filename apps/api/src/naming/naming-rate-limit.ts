import { Injectable } from "@nestjs/common";

const NAMING_PUBLIC_RATE_LIMIT = 5;
const NAMING_PUBLIC_RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Fixed-window limiter for one API process. Reservation creation and name
 * submission use separate counters for each client address.
 */
@Injectable()
export class NamingRateLimiter {
  private readonly hits = new Map<string, number[]>();

  consume(key: string, now = Date.now()): boolean {
    const recent = this.recent(key, now);
    if (recent.length >= NAMING_PUBLIC_RATE_LIMIT) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= NAMING_PUBLIC_RATE_LIMIT;
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - NAMING_PUBLIC_RATE_WINDOW_MS;
    return (this.hits.get(key) ?? []).filter((time) => time > cutoff);
  }
}
