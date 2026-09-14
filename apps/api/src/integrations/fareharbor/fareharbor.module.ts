import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { QueueModule } from "../../queue/queue.module";
import { FAREHARBOR_WEBHOOK_QUEUE } from "../../queue/queue.constants";
import {
  FareharborStatusController,
  FareharborWebhookController,
} from "./fareharbor.controller";
import { FareharborWebhookProcessor } from "./fareharbor-webhook.processor";
import { FareharborWebhookService } from "./fareharbor-webhook.service";

@Module({
  imports: [
    DatabaseModule,
    QueueModule,
    BullModule.registerQueue({
      name: FAREHARBOR_WEBHOOK_QUEUE,
    }),
  ],
  controllers: [FareharborWebhookController, FareharborStatusController],
  providers: [FareharborWebhookService, FareharborWebhookProcessor],
})
export class FareharborModule {}
