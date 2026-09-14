import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { EnvService } from "../../config/env.service";
import { DatabaseService } from "../../database/database.service";
import {
  integrationEvents,
  recoverableIntegrationEventStatuses,
} from "../../database/schema/integration-events";
import { FAREHARBOR_WEBHOOK_QUEUE } from "../../queue/queue.constants";
import {
  FAREHARBOR_BOOKING_ENTITY,
  FAREHARBOR_BOOKING_EVENT_TYPE,
  FAREHARBOR_PROVIDER,
  hashCanonicalJson,
  timingSafeSecretEqual,
} from "./fareharbor.crypto";
import { extractFareharborBookingMetadata } from "./fareharbor.payload";

@Injectable()
export class FareharborWebhookService {
  private readonly logger = new Logger(FareharborWebhookService.name);

  constructor(
    @Inject(EnvService) private readonly env: EnvService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @InjectQueue(FAREHARBOR_WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  get configured(): boolean {
    return this.env.isFareharborWebhookConfigured;
  }

  assertValidSecret(provided: string): void {
    const expected = this.env.fareharborWebhookSecret;
    if (!expected || !timingSafeSecretEqual(provided, expected)) {
      throw new NotFoundException();
    }
  }

  async ingest(body: unknown): Promise<{ duplicate: boolean }> {
    let metadata;
    try {
      metadata = extractFareharborBookingMetadata(body);
    } catch {
      throw new BadRequestException();
    }

    const payloadHash = hashCanonicalJson(body);

    let persisted: {
      eventId: string;
      duplicate: boolean;
      shouldEnqueue: boolean;
    };
    try {
      persisted = await this.persistBookingEvent(body, metadata, payloadHash);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        this.logger.error("FareHarbor webhook could not be persisted");
        throw new ServiceUnavailableException();
      }

      try {
        persisted = await this.persistDuplicate(body, metadata, payloadHash);
      } catch {
        this.logger.error("FareHarbor webhook could not be persisted");
        throw new ServiceUnavailableException();
      }
    }

    if (persisted.shouldEnqueue) {
      try {
        await this.enqueue(persisted.eventId);
      } catch {
        this.logger.warn(
          "FareHarbor event persisted; queueing failed. Recover with npm run integrations:recover.",
        );
      }
    }

    return { duplicate: persisted.duplicate };
  }

  async recoverEligibleEvents(): Promise<{
    found: number;
    enqueued: number;
    skipped: number;
    failed: number;
  }> {
    const rows = await this.database.db
      .select({
        id: integrationEvents.id,
        provider: integrationEvents.provider,
        processingStatus: integrationEvents.processingStatus,
      })
      .from(integrationEvents)
      .where(
        and(
          isNull(integrationEvents.duplicateOf),
          inArray(
            integrationEvents.processingStatus,
            [...recoverableIntegrationEventStatuses],
          ),
        ),
      );

    const summary = { found: rows.length, enqueued: 0, skipped: 0, failed: 0 };

    for (const row of rows) {
      if (row.provider !== FAREHARBOR_PROVIDER) {
        summary.skipped += 1;
        continue;
      }

      try {
        const result = await this.enqueue(row.id);
        if (result === "enqueued") {
          summary.enqueued += 1;
        } else {
          summary.skipped += 1;
        }
      } catch {
        summary.failed += 1;
        this.logger.warn(
          "Failed to re-enqueue a recoverable integration event",
        );
      }
    }

    return summary;
  }

  private async persistBookingEvent(
    body: unknown,
    metadata: ReturnType<typeof extractFareharborBookingMetadata>,
    payloadHash: string,
  ): Promise<{
    eventId: string;
    duplicate: boolean;
    shouldEnqueue: boolean;
  }> {
    const existing = await this.database.db
      .select({
        id: integrationEvents.id,
        processingStatus: integrationEvents.processingStatus,
      })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          eq(integrationEvents.payloadHash, payloadHash),
          isNull(integrationEvents.duplicateOf),
        ),
      )
      .orderBy(integrationEvents.receivedAt)
      .limit(1);

    const original = existing[0];
    const inserted = await this.database.db
      .insert(integrationEvents)
      .values({
        provider: FAREHARBOR_PROVIDER,
        eventType: FAREHARBOR_BOOKING_EVENT_TYPE,
        externalEntityType: FAREHARBOR_BOOKING_ENTITY,
        externalEntityId: metadata.uuid,
        payload: body,
        payloadHash,
        processingStatus: original ? "duplicate" : "received",
        duplicateOf: original?.id,
        safeMetadata: {
          bookingPk: metadata.pk,
          bookingStatus: metadata.status,
          rebookedFrom: metadata.rebookedFrom,
          rebookedTo: metadata.rebookedTo,
        },
      })
      .returning({ id: integrationEvents.id });

    if (original) {
      return {
        eventId: original.id,
        duplicate: true,
        shouldEnqueue: isRecoverableStatus(original.processingStatus),
      };
    }

    const eventId = inserted[0]?.id;
    if (!eventId) {
      throw new Error("persist_failed");
    }

    return { eventId, duplicate: false, shouldEnqueue: true };
  }

  private async persistDuplicate(
    body: unknown,
    metadata: ReturnType<typeof extractFareharborBookingMetadata>,
    payloadHash: string,
  ): Promise<{
    eventId: string;
    duplicate: boolean;
    shouldEnqueue: boolean;
  }> {
    const existing = await this.database.db
      .select({
        id: integrationEvents.id,
        processingStatus: integrationEvents.processingStatus,
      })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          eq(integrationEvents.payloadHash, payloadHash),
          isNull(integrationEvents.duplicateOf),
        ),
      )
      .orderBy(integrationEvents.receivedAt)
      .limit(1);

    const original = existing[0];
    if (!original) {
      throw new Error("persist_failed");
    }

    await this.database.db.insert(integrationEvents).values({
      provider: FAREHARBOR_PROVIDER,
      eventType: FAREHARBOR_BOOKING_EVENT_TYPE,
      externalEntityType: FAREHARBOR_BOOKING_ENTITY,
      externalEntityId: metadata.uuid,
      payload: body,
      payloadHash,
      processingStatus: "duplicate",
      duplicateOf: original.id,
      safeMetadata: {
        bookingPk: metadata.pk,
        bookingStatus: metadata.status,
        rebookedFrom: metadata.rebookedFrom,
        rebookedTo: metadata.rebookedTo,
      },
    });

    return {
      eventId: original.id,
      duplicate: true,
      shouldEnqueue: isRecoverableStatus(original.processingStatus),
    };
  }

  async processEvent(eventId: string): Promise<void> {
    const rows = await this.database.db
      .select({
        id: integrationEvents.id,
        processingStatus: integrationEvents.processingStatus,
        safeMetadata: integrationEvents.safeMetadata,
      })
      .from(integrationEvents)
      .where(eq(integrationEvents.id, eventId))
      .limit(1);

    const event = rows[0];
    if (!event) {
      return;
    }

    if (
      event.processingStatus === "duplicate" ||
      event.processingStatus === "completed"
    ) {
      return;
    }

    await this.database.db
      .update(integrationEvents)
      .set({ processingStatus: "processing", processingError: null })
      .where(eq(integrationEvents.id, eventId));

    try {
      const status = event.safeMetadata?.bookingStatus ?? "unknown";
      this.logger.log(
        `Processed FareHarbor event ${eventId} (${status})`,
      );

      await this.database.db
        .update(integrationEvents)
        .set({
          processingStatus: "completed",
          processedAt: new Date(),
          processingError: null,
        })
        .where(eq(integrationEvents.id, eventId));
    } catch {
      await this.database.db
        .update(integrationEvents)
        .set({
          processingStatus: "failed",
          processingError: "processing failed",
        })
        .where(eq(integrationEvents.id, eventId));
      throw new Error("processing failed");
    }
  }

  async getSafeStatus() {
    if (!this.configured) {
      return {
        provider: "fareharbor" as const,
        configured: false,
        receiverEnabled: false,
        lastWebhookReceivedAt: null,
        unprocessedEventCount: 0,
        failedProcessingCount: 0,
        recoverableEventCount: 0,
      };
    }

    const [latest] = await this.database.db
      .select({ receivedAt: integrationEvents.receivedAt })
      .from(integrationEvents)
      .where(eq(integrationEvents.provider, FAREHARBOR_PROVIDER))
      .orderBy(desc(integrationEvents.receivedAt))
      .limit(1);

    const [unprocessed] = await this.database.db
      .select({ value: count() })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          inArray(integrationEvents.processingStatus, [
            "received",
            "queued",
            "processing",
          ]),
        ),
      );

    const [failed] = await this.database.db
      .select({ value: count() })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          eq(integrationEvents.processingStatus, "failed"),
        ),
      );

    const [recoverable] = await this.database.db
      .select({ value: count() })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, FAREHARBOR_PROVIDER),
          isNull(integrationEvents.duplicateOf),
          inArray(integrationEvents.processingStatus, [
            ...recoverableIntegrationEventStatuses,
          ]),
        ),
      );

    return {
      provider: "fareharbor" as const,
      configured: true,
      receiverEnabled: true,
      lastWebhookReceivedAt: latest?.receivedAt?.toISOString() ?? null,
      unprocessedEventCount: Number(unprocessed?.value ?? 0),
      failedProcessingCount: Number(failed?.value ?? 0),
      recoverableEventCount: Number(recoverable?.value ?? 0),
    };
  }

  private async enqueue(eventId: string): Promise<"enqueued" | "skipped"> {
    const jobId = `fareharbor-${eventId}`;
    const existingJob = await this.queue.getJob(jobId);

    if (existingJob) {
      const state = await existingJob.getState();
      if (
        state === "waiting" ||
        state === "active" ||
        state === "delayed"
      ) {
        return "skipped";
      }

      if (state === "failed") {
        await existingJob.retry();
        await this.markQueued(eventId);
        return "enqueued";
      }

      await existingJob.remove();
    }

    await this.queue.add(
      "process-event",
      { eventId },
      {
        jobId,
        removeOnComplete: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      },
    );
    await this.markQueued(eventId);
    return "enqueued";
  }

  private async markQueued(eventId: string): Promise<void> {
    await this.database.db
      .update(integrationEvents)
      .set({ processingStatus: "queued" })
      .where(
        and(
          eq(integrationEvents.id, eventId),
          inArray(integrationEvents.processingStatus, [
            "received",
            "failed",
            "processing",
          ]),
        ),
      );
  }
}

function isRecoverableStatus(status: string): boolean {
  return recoverableIntegrationEventStatuses.includes(
    status as (typeof recoverableIntegrationEventStatuses)[number],
  );
}

function isUniqueViolation(error: unknown): boolean {
  const codes: string[] = [];
  let current: unknown = error;

  for (let i = 0; i < 4 && current && typeof current === "object"; i += 1) {
    if ("code" in current && typeof current.code === "string") {
      codes.push(current.code);
    }
    current = "cause" in current ? current.cause : undefined;
  }

  if (codes.includes("23505")) {
    return true;
  }

  return error instanceof Error && error.message.includes("23505");
}
