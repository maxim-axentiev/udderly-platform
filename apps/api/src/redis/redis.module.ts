import { Module } from "@nestjs/common";
import Redis from "ioredis";
import { EnvService } from "../config/env.service";
import { REDIS } from "./redis.constants";
import { RedisService } from "./redis.service";

@Module({
  providers: [
    {
      provide: REDIS,
      inject: [EnvService],
      useFactory: (env: EnvService) =>
        new Redis(env.redisUrl, {
          maxRetriesPerRequest: 1,
          lazyConnect: false,
        }),
    },
    {
      provide: RedisService,
      inject: [REDIS],
      useFactory: (client: Redis) => new RedisService(client),
    },
  ],
  exports: [RedisService, REDIS],
})
export class RedisModule {}
