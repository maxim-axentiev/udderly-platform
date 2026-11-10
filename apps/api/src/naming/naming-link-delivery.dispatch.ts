import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { NAMING_LINK_DELIVERY_QUEUE } from "../queue/queue.constants";
import {
  NAMING_LINK_DELIVERY_ATTEMPTS,
  NAMING_LINK_DELIVERY_BACKOFF_MS,
} from "./naming.constants";

export type NamingLinkDeliveryEnqueueResult = "enqueued" | "skipped" | "failed";

/**
 * Queues a naming-link email. The job carries the reservation id only.
 * The token and purchaser address are never written to Redis.
 */
@Injectable()
export class NamingLinkDeliveryDispatchService {
  private readonly logger = new Logger(NamingLinkDeliveryDispatchService.name);

  constructor(
    @InjectQueue(NAMING_LINK_DELIVERY_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(
    reservationId: string,
  ): Promise<NamingLinkDeliveryEnqueueResult> {
    const jobId = namingLinkDeliveryJobId(reservationId);
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
        "deliver-naming-link",
        { reservationId },
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
        `Naming link was not queued for reservation ${reservationId}. Recover with npm run naming:deliver.`,
      );
      return "failed";
    }
  }
}

export function namingLinkDeliveryJobId(reservationId: string): string {
  return `naming-link-${reservationId}`;
}
