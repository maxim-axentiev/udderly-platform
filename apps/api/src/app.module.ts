import { Module } from "@nestjs/common";
import { EnvModule } from "./config/env.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { WherewolfModule } from "./integrations/wherewolf/wherewolf.module";
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
  ],
})
export class AppModule {}
