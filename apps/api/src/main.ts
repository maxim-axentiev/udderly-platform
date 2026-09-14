import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { EnvService } from "./config/env.service";
import { loadEnvFiles } from "./config/load-env";

async function bootstrap(): Promise<void> {
  loadEnvFiles();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: false,
  });

  app.useBodyParser("json", { limit: "2mb" });

  const env = app.get(EnvService);

  app.enableCors({
    origin: env.webOrigin,
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(env.apiPort, env.apiListenHost);

  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://${env.apiListenHost}:${env.apiPort}`);
}

void bootstrap();
