import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

type ActiveSession = {
  expiresAt: number;
  csrf: string;
};

/**
 * Active inventory sessions for this API process. Logout removes the id, so a
 * copied cookie stops working. A restarted process forgets these ids. The
 * stored CSRF token is the one a restored page must send.
 */
@Injectable()
export class InventorySessions {
  private readonly active = new Map<string, ActiveSession>();

  start(expiresAt: number, csrf: string): string {
    const sid = randomBytes(16).toString("base64url");
    this.active.set(sid, { expiresAt, csrf });
    return sid;
  }

  current(sid: string, now: number): ActiveSession | undefined {
    const session = this.active.get(sid);
    if (!session || session.expiresAt <= now) {
      this.active.delete(sid);
      return undefined;
    }
    return session;
  }

  replaceCsrf(sid: string, csrf: string, now: number): boolean {
    const session = this.current(sid, now);
    if (!session) {
      return false;
    }
    session.csrf = csrf;
    return true;
  }

  end(sid: string): void {
    this.active.delete(sid);
  }
}
