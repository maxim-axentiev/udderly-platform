import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { NamingNoticeKind } from "../database/schema/naming";
import { NAMING_NOTICE_QUEUE } from "../queue/queue.constants";
import {
  NAMING_LINK_DELIVERY_ATTEMPTS,
  NAMING_LINK_DELIVERY_BACKOFF_MS,
} from "./naming.constants";

export type NamingNoticeJob = {
  reservationId: string;
  kind: NamingNoticeKind;
};

@Injectable()
export class NamingNoticeDispatchService {
  private readonly logger = new Logger(NamingNoticeDispatchService.name);

  constructor(@InjectQueue(NAMING_NOTICE_QUEUE) private readonly queue: Queue) {}

  async enqueue(
    reservationId: string,
    kind: NamingNoticeKind,
  ): Promise<"enqueued" | "skipped" | "failed"> {
    const jobId = namingNoticeJobId(reservationId, kind);
    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === "waiting" || state === "active" || state === "delayed") {
          return "skipped";
        }
        if (state === "failed") {
          await existingJob.retry();
          return "enqueued";
        }
        await existingJob.remove();
      }
      await this.queue.add(
        "deliver-naming-notice",
        { reservationId, kind } satisfies NamingNoticeJob,
        {
          jobId,
          removeOnComplete: 100,
          attempts: NAMING_LINK_DELIVERY_ATTEMPTS,
          backoff: {
            type: "exponential",
            delay: NAMING_LINK_DELIVERY_BACKOFF_MS,
          },
        },
      );
      return "enqueued";
    } catch {
      this.logger.warn(
        `Naming notice ${kind} was not queued for reservation ${reservationId}.`,
      );
      return "failed";
    }
  }
}

export function namingNoticeJobId(
  reservationId: string,
  kind: NamingNoticeKind,
): string {
  return `naming-notice-${kind}-${reservationId}`;
}
