import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { NAMING_NOTICE_QUEUE } from "../queue/queue.constants";
import type { NamingNoticeJob } from "./naming-notice.dispatch";
import { NamingNoticeService } from "./naming-notice.service";

@Processor(NAMING_NOTICE_QUEUE, { lockDuration: 60_000 })
export class NamingNoticeProcessor extends WorkerHost {
  private readonly logger = new Logger(NamingNoticeProcessor.name);

  constructor(
    @Inject(NamingNoticeService)
    private readonly notices: NamingNoticeService,
  ) {
    super();
  }

  async process(job: Job<NamingNoticeJob>): Promise<void> {
    if (!job.data.reservationId || !job.data.kind) {
      this.logger.error("Naming notice job is missing its target");
      return;
    }
    const result = await this.notices.deliver(
      job.data.reservationId,
      job.data.kind,
    );
    if (
      result.outcome === "smtp_failed" ||
      result.outcome === "in_progress" ||
      result.outcome === "not_configured"
    ) {
      throw new Error(`naming_notice_${result.outcome}`);
    }
  }
}
