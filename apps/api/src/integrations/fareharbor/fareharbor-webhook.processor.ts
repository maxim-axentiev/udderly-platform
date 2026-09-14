import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { FAREHARBOR_WEBHOOK_QUEUE } from "../../queue/queue.constants";
import { FareharborWebhookService } from "./fareharbor-webhook.service";

type FareharborJobData = {
  eventId: string;
};

@Processor(FAREHARBOR_WEBHOOK_QUEUE)
export class FareharborWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(FareharborWebhookProcessor.name);

  constructor(
    @Inject(FareharborWebhookService)
    private readonly fareharbor: FareharborWebhookService,
  ) {
    super();
  }

  async process(job: Job<FareharborJobData>): Promise<void> {
    if (!job.data.eventId) {
      this.logger.error("FareHarbor job missing event id");
      return;
    }

    await this.fareharbor.processEvent(job.data.eventId);
  }
}
