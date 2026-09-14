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
import { integrationEvents } from "../../database/schema/integration-events";
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

    try {
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

      const eventId = original?.id ?? inserted[0]?.id;
      if (!eventId) {
        throw new Error("persist_failed");
      }

      if (original) {
        if (
          original.processingStatus === "received" ||
          original.processingStatus === "failed"
        ) {
          await this.enqueue(eventId);
        }
        return { duplicate: true };
      }

      await this.enqueue(eventId);
      return { duplicate: false };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        return this.storeDuplicate(body, metadata, payloadHash);
      }

      this.logger.error("FareHarbor webhook could not be persisted or queued");
      throw new ServiceUnavailableException();
    }
  }

  private async storeDuplicate(
    body: unknown,
    metadata: ReturnType<typeof extractFareharborBookingMetadata>,
    payloadHash: string,
  ): Promise<{ duplicate: boolean }> {
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
      throw new ServiceUnavailableException();
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

    if (
      original.processingStatus === "received" ||
      original.processingStatus === "failed"
    ) {
      await this.enqueue(original.id);
    }

    return { duplicate: true };
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

    return {
      provider: "fareharbor" as const,
      configured: true,
      receiverEnabled: true,
      lastWebhookReceivedAt: latest?.receivedAt?.toISOString() ?? null,
      unprocessedEventCount: Number(unprocessed?.value ?? 0),
      failedProcessingCount: Number(failed?.value ?? 0),
    };
  }

  private async enqueue(eventId: string): Promise<void> {
    try {
      await this.queue.add(
        "process-event",
        { eventId },
        {
          jobId: `fareharbor-${eventId}`,
          removeOnComplete: 100,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.toLowerCase().includes("exist")) {
        throw error;
      }
    }

    await this.database.db
      .update(integrationEvents)
      .set({ processingStatus: "queued" })
      .where(
        and(
          eq(integrationEvents.id, eventId),
          inArray(integrationEvents.processingStatus, ["received", "failed"]),
        ),
      );
  }
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
