import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { NAMING_LINK_DELIVERY_QUEUE } from "../queue/queue.constants";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";

type NamingLinkDeliveryJobData = {
  reservationId?: string;
};

@Processor(NAMING_LINK_DELIVERY_QUEUE, { lockDuration: 60_000 })
export class NamingLinkDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(NamingLinkDeliveryProcessor.name);

  constructor(
    @Inject(NamingLinkDeliveryService)
    private readonly delivery: NamingLinkDeliveryService,
  ) {
    super();
  }

  async process(job: Job<NamingLinkDeliveryJobData>): Promise<void> {
    const reservationId = job.data.reservationId;
    if (!reservationId) {
      this.logger.error("Naming link delivery job missing reservation id");
      return;
    }

    const result = await this.delivery.deliver(reservationId);
    if (
      result.outcome === "smtp_failed" ||
      result.outcome === "in_progress" ||
      result.outcome === "uncommitted" ||
      result.outcome === "not_configured"
    ) {
      throw new Error(`naming_link_delivery_${result.outcome}`);
    }
  }
}
