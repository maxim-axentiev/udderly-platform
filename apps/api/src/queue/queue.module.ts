import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { EnvService } from "../config/env.service";
import { PLATFORM_QUEUE } from "./queue.constants";

function redisConnectionFromUrl(redisUrl: string) {
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        connection: redisConnectionFromUrl(env.redisUrl),
      }),
    }),
    BullModule.registerQueue({
      name: PLATFORM_QUEUE,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
