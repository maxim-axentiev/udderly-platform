import { Injectable, Logger } from "@nestjs/common";
import { EnvService } from "../../config/env.service";
import { WherewolfClient } from "./wherewolf.client";
import { WherewolfApiError } from "./wherewolf.errors";
import { recentUtcRange } from "./wherewolf.range";
import type { WherewolfConnectionStatus } from "./wherewolf.types";

@Injectable()
export class WherewolfService {
  private readonly logger = new Logger(WherewolfService.name);

  constructor(private readonly env: EnvService) {}

  get configured(): boolean {
    return this.env.isWherewolfConfigured;
  }

  statusWhenUnconfigured(): WherewolfConnectionStatus {
    return {
      provider: "wherewolf",
      configured: false,
      connected: false,
    };
  }

  async getConnectionStatus(): Promise<WherewolfConnectionStatus> {
    if (!this.configured) {
      return this.statusWhenUnconfigured();
    }

    try {
      await this.verifyConnection();
      return {
        provider: "wherewolf",
        configured: true,
        connected: true,
      };
    } catch (error) {
      this.logSafeFailure("connection test", error);
      return {
        provider: "wherewolf",
        configured: true,
        connected: false,
      };
    }
  }

  async verifyConnection(): Promise<void> {
    const client = this.requireClient();
    const range = recentUtcRange(1);
    await client.getReservations(range);
    await client.getGuestsByFilter(range, 1);
  }

  private requireClient(): WherewolfClient {
    const apiKey = this.env.wherewolfApiKey;
    const appId = this.env.wherewolfAppId;

    if (!apiKey || !appId) {
      throw new WherewolfApiError("Wherewolf is not configured");
    }

    return new WherewolfClient({ apiKey, appId });
  }

  private logSafeFailure(action: string, error: unknown): void {
    const message =
      error instanceof WherewolfApiError
        ? error.message
        : "Wherewolf request failed";

    this.logger.warn(`Wherewolf ${action} failed: ${message}`);
  }
}
