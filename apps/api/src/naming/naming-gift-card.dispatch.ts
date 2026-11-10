import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { integrationEvents } from "../database/schema/integration-events";
import { FAREHARBOR_PROVIDER } from "../integrations/fareharbor/fareharbor.crypto";
import { NAMING_GIFT_CARD_QUEUE } from "../queue/queue.constants";
import { FAREHARBOR_GIFT_CARD_ITEM_ID } from "./naming.constants";

export type NamingGiftCardEnqueueResult = "enqueued" | "skipped" | "failed";

export type NamingGiftCardReplayResult = {
  found: number;
  enqueued: number;
  skipped: number;
  failed: number;
};

/**
 * Queues stored FareHarbor gift-card events for matching. It does not create
 * reservations and does not change the webhook inbox status.
 */
@Injectable()
export class NamingGiftCardDispatchService {
  private readonly logger = new Logger(NamingGiftCardDispatchService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @InjectQueue(NAMING_GIFT_CARD_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueueEvent(eventId: string): Promise<NamingGiftCardEnqueueResult> {
    const jobId = namingGiftCardJobId(eventId);
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
        "match-gift-card",
        { eventId },
        {
          jobId,
          removeOnComplete: 100,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
        },
      );
      return "enqueued";
    } catch {
      this.logger.warn(
        "Naming gift-card match was not queued. Recover with npm run naming:match-gifts.",
      );
      return "failed";
    }
  }

  async replayStoredGiftCards(): Promise<NamingGiftCardReplayResult> {
    const rows = await this.database.db
      .select({ id: integrationEvents.id })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          isNull(integrationEvents.duplicateOf),
          sql`${integrationEvents.payload} #>> '{booking,availability,item,pk}' = ${FAREHARBOR_GIFT_CARD_ITEM_ID}`,
        ),
      );

    const summary: NamingGiftCardReplayResult = {
      found: rows.length,
      enqueued: 0,
      skipped: 0,
      failed: 0,
    };
    for (const row of rows) {
      summary[await this.enqueueEvent(row.id)] += 1;
    }
    return summary;
  }
}

export function namingGiftCardJobId(eventId: string): string {
  return `naming-gift-${eventId}`;
}
