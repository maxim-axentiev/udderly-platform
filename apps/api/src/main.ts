import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { EnvService } from "./config/env.service";
import { loadEnvFiles } from "./config/load-env";

async function bootstrap(): Promise<void> {
  loadEnvFiles();

  const app = await NestFactory.create(AppModule, {
    cors: false,
  });

  const env = app.get(EnvService);

  app.enableCors({
    origin: env.webOrigin,
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(env.apiPort, "127.0.0.1");

  const logger = new Logger("Bootstrap");
  logger.log(`API listening on http://127.0.0.1:${env.apiPort}`);
}

void bootstrap();
