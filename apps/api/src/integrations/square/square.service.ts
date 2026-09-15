import { Injectable, Logger } from "@nestjs/common";
import { EnvService } from "../../config/env.service";
import { SquareClient } from "./square.client";
import { SquareApiError } from "./square.errors";
import type { SquareConnectionStatus } from "./square.types";

@Injectable()
export class SquareService {
  private readonly logger = new Logger(SquareService.name);

  constructor(private readonly env: EnvService) {}

  get configured(): boolean {
    return this.env.isSquareConfigured;
  }

  async getConnectionStatus(): Promise<SquareConnectionStatus> {
    if (!this.configured) {
      return {
        provider: "square",
        configured: false,
        connected: false,
      };
    }

    try {
      const client = this.requireClient();
      await client.listLocations();
      return {
        provider: "square",
        configured: true,
        connected: true,
      };
    } catch (error) {
      this.logSafeFailure("connection test", error);
      return {
        provider: "square",
        configured: true,
        connected: false,
      };
    }
  }

  private requireClient(): SquareClient {
    const accessToken = this.env.squareAccessToken;
    const locationId = this.env.squareLocationId;

    if (!accessToken || !locationId || !this.env.squareApplicationId) {
      throw new SquareApiError("Square is not configured");
    }

    return new SquareClient({ accessToken, locationId });
  }

  private logSafeFailure(action: string, error: unknown): void {
    const message =
      error instanceof SquareApiError ? error.message : "Square request failed";

    this.logger.warn(`Square ${action} failed: ${message}`);
  }
}
