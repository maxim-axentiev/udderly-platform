import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(readonly client: Redis) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ping();
      this.logger.log("Connected to Redis");
    } catch (error) {
      this.logger.error(
        "Redis is not reachable. Start Docker services and retry.",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async ping(): Promise<void> {
    const result = await this.client.ping();
    if (result !== "PONG") {
      throw new Error(`Unexpected Redis ping response: ${result}`);
    }
  }
}
