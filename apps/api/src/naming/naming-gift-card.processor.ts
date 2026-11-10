import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger, Optional } from "@nestjs/common";
import { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { integrationEvents } from "../database/schema/integration-events";
import { FAREHARBOR_PROVIDER } from "../integrations/fareharbor/fareharbor.crypto";
import { NAMING_GIFT_CARD_QUEUE } from "../queue/queue.constants";
import { isFareharborGiftCardItem } from "./naming-gift-card";
import { NamingGiftCardService } from "./naming-gift-card.service";
import { NamingLinkDeliveryDispatchService } from "./naming-link-delivery.dispatch";
import { NamingNoticeDispatchService } from "./naming-notice.dispatch";

type NamingGiftCardJobData = {
  eventId?: string;
};

@Processor(NAMING_GIFT_CARD_QUEUE)
export class NamingGiftCardProcessor extends WorkerHost {
  private readonly logger = new Logger(NamingGiftCardProcessor.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NamingGiftCardService)
    private readonly gifts: NamingGiftCardService,
    @Optional()
    @Inject(NamingLinkDeliveryDispatchService)
    private readonly delivery?: NamingLinkDeliveryDispatchService,
    @Optional()
    @Inject(NamingNoticeDispatchService)
    private readonly notices?: NamingNoticeDispatchService,
  ) {
    super();
  }

  async process(job: Job<NamingGiftCardJobData>): Promise<void> {
    if (!job.data.eventId) {
      this.logger.error("Naming gift-card job missing event id");
      return;
    }

    const [event] = await this.database.db
      .select({
        provider: integrationEvents.provider,
        duplicateOf: integrationEvents.duplicateOf,
        payload: integrationEvents.payload,
      })
      .from(integrationEvents)
      .where(eq(integrationEvents.id, job.data.eventId))
      .limit(1);
    if (!event || event.provider !== FAREHARBOR_PROVIDER || event.duplicateOf) {
      return;
    }
    if (!isFareharborGiftCardItem(event.payload)) {
      return;
    }

    const result = await this.gifts.match(event.payload);
    if (
      this.notices &&
      (result.outcome === "underpaid" ||
        result.outcome === "purchase_after_deadline")
    ) {
      await this.notices.enqueue(result.reservationId, result.outcome);
      return;
    }
    if (
      !this.delivery ||
      (result.outcome !== "claimed" && result.outcome !== "duplicate")
    ) {
      return;
    }
    await this.delivery.enqueue(result.reservationId);
  }
}
