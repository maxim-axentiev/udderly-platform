import { Injectable } from "@nestjs/common";
import type { HealthResponse, HealthStatus } from "@udderly/shared";
import { DatabaseService } from "../database/database.service";
import { RedisService } from "../redis/redis.service";

export type ReadinessCheck = {
  status: "up" | "down";
  error?: string;
};

export type ReadinessResponse = {
  status: HealthStatus;
  checks: {
    postgres: ReadinessCheck;
    redis: ReadinessCheck;
  };
};

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  liveness(): HealthResponse {
    return { status: "ok" };
  }

  async readiness(): Promise<ReadinessResponse> {
    const [postgres, redis] = await Promise.all([
      this.check("postgres", () => this.database.ping()),
      this.check("redis", () => this.redis.ping()),
    ]);

    const checks = { postgres, redis };
    const allUp = Object.values(checks).every((check) => check.status === "up");

    return {
      status: allUp ? "ok" : "degraded",
      checks,
    };
  }

  private async check(
    _name: string,
    ping: () => Promise<void>,
  ): Promise<ReadinessCheck> {
    try {
      await ping();
      return { status: "up" };
    } catch (error) {
      return {
        status: "down",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
