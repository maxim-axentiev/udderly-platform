import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { RedactWebhookPathMiddleware } from "./common/redact-webhook-path.middleware";
import { EnvModule } from "./config/env.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { WherewolfModule } from "./integrations/wherewolf/wherewolf.module";
import { FareharborModule } from "./integrations/fareharbor/fareharbor.module";
import { QueueModule } from "./queue/queue.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    HealthModule,
    WherewolfModule,
    FareharborModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RedactWebhookPathMiddleware).forRoutes("*");
  }
}
