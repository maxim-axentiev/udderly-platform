import { BullModule } from "@nestjs/bullmq";
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { EnvService } from "../config/env.service";
import { DatabaseModule } from "../database/database.module";
import {
  NAMING_GIFT_CARD_QUEUE,
  NAMING_HOLD_QUEUE,
  NAMING_LINK_DELIVERY_QUEUE,
  NAMING_NOTICE_QUEUE,
} from "../queue/queue.constants";
import { QueueModule } from "../queue/queue.module";
import { NamingGiftCardDispatchService } from "./naming-gift-card.dispatch";
import { NamingGiftCardProcessor } from "./naming-gift-card.processor";
import { NamingGiftCardService } from "./naming-gift-card.service";
import { NamingLinkDeliveryDispatchService } from "./naming-link-delivery.dispatch";
import { NamingLinkDeliveryProcessor } from "./naming-link-delivery.processor";
import { NamingNoticeDispatchService } from "./naming-notice.dispatch";
import { NamingNoticeProcessor } from "./naming-notice.processor";
import { NamingNoticeService } from "./naming-notice.service";
import { NamingStaffService } from "./naming-staff.service";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";
import { NamingLinkService } from "./naming-link.service";
import { NamingMailer } from "./naming-mailer";
import { NamingHoldProcessor } from "./naming-hold.processor";
import { NamingInventoryController, NamingPhotoController } from "./naming-inventory.controller";
import { applyInventoryPhotoParser } from "./naming-inventory.photo";
import { InventorySessions } from "./naming-inventory.sessions";
import { NamingObjectService } from "./naming-object.service";
import { NamingPublicController } from "./naming-public.controller";
import { NamingPublicService } from "./naming-public.service";
import { NamingRateLimiter } from "./naming-rate-limit";
import { NamingReservationService } from "./naming-reservation.service";
import { FAREHARBOR_TIER_CHECKOUTS, NAMING_CLOCK } from "./naming.constants";

@Module({
  imports: [
    DatabaseModule,
    QueueModule,
    BullModule.registerQueue(
      { name: NAMING_HOLD_QUEUE },
      { name: NAMING_GIFT_CARD_QUEUE },
      { name: NAMING_LINK_DELIVERY_QUEUE },
      { name: NAMING_NOTICE_QUEUE },
    ),
  ],
  controllers: [
    NamingPublicController,
    NamingInventoryController,
    NamingPhotoController,
  ],
  providers: [
    NamingObjectService,
    NamingReservationService,
    NamingGiftCardService,
    NamingGiftCardDispatchService,
    NamingGiftCardProcessor,
    NamingMailer,
    NamingLinkDeliveryService,
    NamingLinkDeliveryDispatchService,
    NamingLinkDeliveryProcessor,
    NamingNoticeService,
    NamingNoticeDispatchService,
    NamingNoticeProcessor,
    NamingStaffService,
    NamingLinkService,
    NamingPublicService,
    NamingRateLimiter,
    InventorySessions,
    NamingHoldProcessor,
    {
      provide: NAMING_CLOCK,
      useValue: () => new Date(),
    },
    {
      provide: FAREHARBOR_TIER_CHECKOUTS,
      useFactory: (env: EnvService) => env.fareharborTierCheckouts,
      inject: [EnvService],
    },
  ],
  exports: [NamingGiftCardDispatchService],
})
export class NamingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    applyInventoryPhotoParser(consumer);
  }
}
