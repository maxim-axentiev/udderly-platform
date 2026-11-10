import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { EnvService } from "../config/env.service";
import {
  applySqlMigrations,
  NAMING_SCHEMA_MIGRATIONS,
} from "../database/apply-sql-migration";
import { integrationEvents } from "../database/schema/integration-events";
import { namingObjects, namingReservations } from "../database/schema/naming";
import { NamingGiftCardProcessor } from "./naming-gift-card.processor";
import { createNamingToken, hashNamingToken } from "./naming-gift-card";
import { namingLinkMessage, namingLinkUrl } from "./naming-link-delivery";
import {
  NamingLinkDeliveryDispatchService,
  namingLinkDeliveryJobId,
} from "./naming-link-delivery.dispatch";
import { NamingLinkDeliveryProcessor } from "./naming-link-delivery.processor";
import { NamingLinkDeliveryService } from "./naming-link-delivery.service";
import {
  GMAIL_SMTP_HOST,
  GMAIL_SMTP_PORT,
  gmailTransportOptions,
  resendIdempotencyKey,
} from "./naming-mailer";
import {
  NAMING_LINK_DELIVERY_ATTEMPTS,
  NAMING_LINK_DELIVERY_BACKOFF_MS,
} from "./naming.constants";

const PURCHASER = "purchaser@example.invalid";
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-03T16:00:00.000Z");

test("Gmail SMTP uses the farm host on the secure port", () => {
  const auth = { user: "farm@example.com", appPassword: "test-app-password" };
  const options = gmailTransportOptions(auth);
  assert.equal(options.host, GMAIL_SMTP_HOST);
  assert.equal(options.host, "smtp.gmail.com");
  assert.equal(options.port, GMAIL_SMTP_PORT);
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.auth?.user, auth.user);
  assert.equal(options.auth?.pass, auth.appPassword);
});

test("the naming message explains the link and the separate gift card", () => {
  const token = createNamingToken().token;
  const url = namingLinkUrl("https://names.example.com", token);
  const message = namingLinkMessage("Wheelbarrow", url);
  assert.equal(url, `https://names.example.com/name/${token}`);
  assert.match(message.subject, /Wheelbarrow/);
  assert.match(message.text, /naming rights/);
  assert.match(message.text, /Wheelbarrow/);
  assert.match(message.text, new RegExp(token));
  assert.match(message.text, /Share that link/);
  assert.match(message.text, /FareHarbor delivers the gift card/);
});

test("a verified claim queues delivery with the reservation id only", async () => {
  const queued: string[] = [];
  const processor = new NamingGiftCardProcessor(
    giftCardDatabase() as never,
    {
      match: async () => ({
        outcome: "claimed",
        reservationId: RESERVATION_ID,
        objectId: "22222222-2222-4222-8222-222222222222",
      }),
    } as never,
    {
      enqueue: async (reservationId: string) => {
        queued.push(reservationId);
        return "enqueued";
      },
    } as never,
  );
  await processor.process({ data: { eventId: "event-1" } } as never);
  assert.deepEqual(queued, [RESERVATION_ID]);

  const duplicate = new NamingGiftCardProcessor(
    giftCardDatabase() as never,
    {
      match: async () => ({
        outcome: "duplicate",
        reservationId: RESERVATION_ID,
      }),
    } as never,
    {
      enqueue: async (reservationId: string) => {
        queued.push(reservationId);
        return "enqueued";
      },
    } as never,
  );
  await duplicate.process({ data: { eventId: "event-2" } } as never);
  assert.deepEqual(queued, [RESERVATION_ID, RESERVATION_ID]);

  const refunded = new NamingGiftCardProcessor(
    giftCardDatabase() as never,
    {
      match: async () => ({
        outcome: "payment_reversed",
        reservationId: RESERVATION_ID,
      }),
    } as never,
    {
      enqueue: async () => {
        throw new Error("refunded claims must not queue a naming link");
      },
    } as never,
  );
  await refunded.process({ data: { eventId: "event-3" } } as never);
});

test("delivery jobs carry only the reservation id and retry failures", async () => {
  const jobs = new Map<string, { state: string; data: unknown; added: number }>();
  const queue = {
    async getJob(jobId: string) {
      const job = jobs.get(jobId);
      if (!job) {
        return undefined;
      }
      return {
        getState: async () => job.state,
        retry: async () => {
          job.state = "waiting";
        },
        remove: async () => {
          jobs.delete(jobId);
        },
      };
    },
    async add(
      _name: string,
      data: { reservationId: string },
      options: { jobId: string; attempts: number; backoff: { type: string; delay: number } },
    ) {
      assert.deepEqual(Object.keys(data), ["reservationId"]);
      assert.equal(JSON.stringify(data).includes("token"), false);
      assert.equal(options.attempts, NAMING_LINK_DELIVERY_ATTEMPTS);
      assert.deepEqual(options.backoff, {
        type: "exponential",
        delay: NAMING_LINK_DELIVERY_BACKOFF_MS,
      });
      const current = jobs.get(options.jobId);
      jobs.set(options.jobId, {
        state: "waiting",
        data,
        added: (current?.added ?? 0) + 1,
      });
    },
  };
  const dispatch = new NamingLinkDeliveryDispatchService(queue as never);
  assert.equal(await dispatch.enqueue(RESERVATION_ID), "enqueued");
  assert.equal(jobs.get(namingLinkDeliveryJobId(RESERVATION_ID))?.added, 1);
  assert.equal(await dispatch.enqueue(RESERVATION_ID), "skipped");
  const failed = jobs.get(namingLinkDeliveryJobId(RESERVATION_ID));
  assert.ok(failed);
  failed.state = "failed";
  assert.equal(await dispatch.enqueue(RESERVATION_ID), "enqueued");
  assert.equal(failed.state, "waiting");
});

test("the delivery worker retries a rejected send and ignores a finished one", async () => {
  const failed = new NamingLinkDeliveryProcessor({
    deliver: async (reservationId: string) => {
      assert.equal(reservationId, RESERVATION_ID);
      return { outcome: "smtp_failed" };
    },
  } as never);
  await assert.rejects(
    () =>
      failed.process({
        data: { reservationId: RESERVATION_ID, token: "not-stored" },
      } as never),
    /naming_link_delivery_smtp_failed/,
  );

  let calls = 0;
  const sent = new NamingLinkDeliveryProcessor({
    deliver: async () => {
      calls += 1;
      return { outcome: "sent" };
    },
  } as never);
  await sent.process({ data: { reservationId: RESERVATION_ID } } as never);
  await sent.process({ data: {} } as never);
  assert.equal(calls, 1);
});

test("incomplete mail settings do not send or open the database", async () => {
  const mail = new FakeMail();
  const databaseGuard = {
    db: {
      transaction() {
        throw new Error("database used");
      },
    },
  };
  const missingMail = new NamingLinkDeliveryService(
    databaseGuard as never,
    mail as never,
    {
      namingMailConfigured: false,
      namingPublicBaseUrl: "https://names.example.com",
    } as EnvService,
    () => now,
  );
  assert.deepEqual(await missingMail.deliver(RESERVATION_ID), {
    outcome: "not_configured",
  });

  const missingBase = new NamingLinkDeliveryService(
    databaseGuard as never,
    mail as never,
    {
      namingMailConfigured: true,
      namingResend: {
        apiKey: "re_test_key",
        from: "naming@send.example.com",
        replyTo: "marketing@example.com",
      },
      namingSmtp: undefined,
    } as EnvService,
    () => now,
  );
  assert.deepEqual(await missingBase.deliver(RESERVATION_ID), {
    outcome: "not_configured",
  });
  assert.equal(mail.attempts.length, 0);
});

const databaseUrl = deliveryDatabaseUrl();
let sqlClient: postgres.Sql | undefined;
let database: ReturnType<typeof drizzle>;

test.before(async () => {
  if (!databaseUrl) {
    return;
  }
  await ensureDeliveryDatabase();
  sqlClient = postgres(databaseUrl, { max: 8, onnotice: () => {} });
  await sqlClient.unsafe("drop table if exists naming_notice cascade");
  await sqlClient.unsafe("drop table if exists naming_name_revision cascade");
  await sqlClient.unsafe("drop table if exists naming_reservation cascade");
  await sqlClient.unsafe("drop table if exists naming_object cascade");
  await sqlClient.unsafe("drop table if exists integration_events cascade");
  await applySqlMigrations(sqlClient, [
    "0001_integration_events.sql",
    ...NAMING_SCHEMA_MIGRATIONS,
  ]);
  database = drizzle(sqlClient);
});

test.after(async () => {
  await sqlClient?.end({ timeout: 5 });
});

test("a verified purchase emails one naming link and stores only its hash", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Wheelbarrow");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  const service = deliveryService(mail);
  const result = await service.deliver(seeded.reservationId);
  assert.deepEqual(result, { outcome: "sent" });
  assert.equal(JSON.stringify(result).includes(PURCHASER), false);
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0]?.to, PURCHASER);
  const token = tokenFrom(mail.messages[0]?.text ?? "");
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.linkDeliveryStatus, "sent");
  assert.equal(reservation.namingTokenHash, hashNamingToken(token));
  assert.equal(JSON.stringify(reservation).includes(token), false);
  assert.equal(JSON.stringify(reservation).includes(PURCHASER), false);
  assert.match(mail.messages[0]?.text ?? "", /naming rights/);
  assert.match(mail.messages[0]?.text ?? "", /Wheelbarrow/);
  assert.match(mail.messages[0]?.text ?? "", /Share that link/);
  assert.match(mail.messages[0]?.text ?? "", /FareHarbor delivers the gift card/);

  const duplicate = await service.deliver(seeded.reservationId);
  assert.deepEqual(duplicate, { outcome: "already_sent" });
  assert.equal(mail.messages.length, 1);
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    reservation.namingTokenHash,
  );
});

test("an SMTP rejection leaves no active link and a retry sends one", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Tractor");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  mail.fail = true;
  const service = deliveryService(mail);
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "smtp_failed",
  });
  const failed = await loadReservation(seeded.reservationId);
  assert.equal(failed.linkDeliveryStatus, "failed");
  assert.equal(failed.namingTokenHash, null);
  assert.equal(mail.messages.length, 0);

  mail.fail = false;
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "sent",
  });
  const sent = await loadReservation(seeded.reservationId);
  const token = tokenFrom(mail.messages[0]?.text ?? "");
  assert.equal(sent.linkDeliveryStatus, "sent");
  assert.equal(sent.namingTokenHash, hashNamingToken(token));
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.attempts.length, 2);
  const failedAttempt = mail.attempts[0];
  const sentAttempt = mail.attempts[1];
  assert.ok(failedAttempt);
  assert.ok(sentAttempt);
  assert.notEqual(failedAttempt.text, sentAttempt.text);
  const failedKey = resendIdempotencyKey({
    reservationId: seeded.reservationId,
    from: "naming@send.example.com",
    to: failedAttempt.to,
    replyTo: "marketing@example.com",
    subject: failedAttempt.subject,
    text: failedAttempt.text,
  });
  const sentKey = resendIdempotencyKey({
    reservationId: seeded.reservationId,
    from: "naming@send.example.com",
    to: sentAttempt.to,
    replyTo: "marketing@example.com",
    subject: sentAttempt.subject,
    text: sentAttempt.text,
  });
  assert.notEqual(failedKey, sentKey);
  assert.equal(failedKey.includes(tokenFrom(failedAttempt.text)), false);
  assert.equal(sentKey.includes(token), false);
});

test("a stale sending row is the crash window and recovery stores one replacement", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Poop Vacuum");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  await database
    .update(namingReservations)
    .set({
      linkDeliveryStatus: "sending",
      linkDeliveryStartedAt: new Date(now.getTime() - 120_000),
    })
    .where(eq(namingReservations.id, seeded.reservationId));
  const mail = new FakeMail();
  const service = deliveryService(mail);
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "sent",
  });
  const token = tokenFrom(mail.messages[0]?.text ?? "");
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.namingTokenHash, hashNamingToken(token));
  assert.equal(reservation.linkDeliveryStatus, "sent");
  assert.equal(mail.messages.length, 1);
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "already_sent",
  });
  assert.equal(mail.messages.length, 1);
});

test("a fresh send is not interrupted by a second attempt", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Gate");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  await database
    .update(namingReservations)
    .set({
      linkDeliveryStatus: "sending",
      linkDeliveryStartedAt: now,
    })
    .where(eq(namingReservations.id, seeded.reservationId));
  const mail = new FakeMail();
  assert.deepEqual(await deliveryService(mail).deliver(seeded.reservationId), {
    outcome: "in_progress",
  });
  assert.equal(mail.messages.length, 0);
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.namingTokenHash, null);
  assert.equal(reservation.linkDeliveryStatus, "sending");
});

test("acceptance without a stored hash sends a replacement and keeps one active link", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Shed");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  mail.duringSend = async () => {
    await database
      .update(namingReservations)
      .set({ linkDeliveryStatus: "failed" })
      .where(eq(namingReservations.id, seeded.reservationId));
  };
  const service = deliveryService(mail);
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "uncommitted",
  });
  const lost = tokenFrom(mail.messages[0]?.text ?? "");
  assert.equal((await loadReservation(seeded.reservationId)).namingTokenHash, null);

  mail.duringSend = undefined;
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "sent",
  });
  const replacement = tokenFrom(mail.messages[1]?.text ?? "");
  const reservation = await loadReservation(seeded.reservationId);
  assert.notEqual(lost, replacement);
  assert.equal(reservation.namingTokenHash, hashNamingToken(replacement));
  assert.notEqual(reservation.namingTokenHash, hashNamingToken(lost));
  assert.equal(JSON.stringify(reservation).includes(lost), false);
  assert.equal(JSON.stringify(reservation).includes(replacement), false);
});

test("refunded, reversed, and unverified purchases are not emailed", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const mail = new FakeMail();
  const service = deliveryService(mail);

  const reversed = await insertClaimed("Reversed item");
  await database
    .update(namingReservations)
    .set({ reviewReason: "payment_reversed" })
    .where(eq(namingReservations.id, reversed.reservationId));
  await insertWebhook(reversed.bookingUuid, webhookPayload(reversed.bookingUuid));
  assert.deepEqual(await service.deliver(reversed.reservationId), {
    outcome: "not_eligible",
  });

  const refunded = await insertClaimed("Refunded item");
  await insertWebhook(
    refunded.bookingUuid,
    webhookPayload(refunded.bookingUuid, { refunds: [{ pk: 1 }] }),
  );
  assert.deepEqual(await service.deliver(refunded.reservationId), {
    outcome: "not_eligible",
  });
  assert.equal((await loadReservation(refunded.reservationId)).linkDeliveryStatus, null);

  const mismatched = await insertClaimed("Mismatch item");
  await insertWebhook(
    mismatched.bookingUuid,
    webhookPayload(mismatched.bookingUuid, { paidAmount: 1500 }),
  );
  assert.deepEqual(await service.deliver(mismatched.reservationId), {
    outcome: "not_eligible",
  });

  const review = await insertReview("Review item");
  assert.deepEqual(await service.deliver(review.reservationId), {
    outcome: "not_eligible",
  });

  const held = await insertHeld("Held item");
  assert.deepEqual(await service.deliver(held.reservationId), {
    outcome: "not_eligible",
  });
  assert.equal(mail.messages.length, 0);
});

test("a refund that arrives during sending does not activate the emailed token", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Late refund");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  mail.duringSend = async () => {
    await database
      .update(namingReservations)
      .set({ reviewReason: "payment_reversed" })
      .where(eq(namingReservations.id, seeded.reservationId));
  };
  const service = deliveryService(mail);
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "not_eligible",
  });
  const leaked = tokenFrom(mail.messages[0]?.text ?? "");
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(reservation.namingTokenHash, null);
  assert.equal(reservation.linkDeliveryStatus, "failed");
  assert.notEqual(reservation.namingTokenHash, hashNamingToken(leaked));
  mail.duringSend = undefined;
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "not_eligible",
  });
  assert.equal(mail.messages.length, 1);
});

test("reissue emails a replacement and a failed reissue leaves no active link", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Reissue item");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  const service = deliveryService(mail);
  assert.equal((await service.deliver(seeded.reservationId)).outcome, "sent");
  const first = tokenFrom(mail.messages[0]?.text ?? "");
  assert.equal(
    (await service.deliver(seeded.reservationId, { reissue: true })).outcome,
    "sent",
  );
  const second = tokenFrom(mail.messages[1]?.text ?? "");
  assert.notEqual(first, second);
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    hashNamingToken(second),
  );

  mail.fail = true;
  assert.deepEqual(
    await service.deliver(seeded.reservationId, { reissue: true }),
    { outcome: "smtp_failed" },
  );
  const failed = await loadReservation(seeded.reservationId);
  assert.equal(failed.namingTokenHash, null);
  assert.equal(failed.linkDeliveryStatus, "failed");
  mail.fail = false;
  assert.equal((await service.deliver(seeded.reservationId)).outcome, "sent");
  const third = tokenFrom(mail.messages[2]?.text ?? "");
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    hashNamingToken(third),
  );
  assert.notEqual(third, second);
});

test("a named item cannot be reissued and a manual link is not emailed silently", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Named item");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const manual = createNamingToken();
  await database
    .update(namingReservations)
    .set({
      namingTokenHash: manual.hash,
      submittedName: "Buttercup",
      namedAt: now,
      linkDeliveryStatus: "sent",
      linkDeliveryStartedAt: now,
    })
    .where(eq(namingReservations.id, seeded.reservationId));
  const mail = new FakeMail();
  const service = deliveryService(mail);
  assert.deepEqual(await service.deliver(seeded.reservationId, { reissue: true }), {
    outcome: "already_named",
  });
  assert.equal(mail.messages.length, 0);
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    manual.hash,
  );

  await database
    .update(namingReservations)
    .set({
      submittedName: null,
      namedAt: null,
      linkDeliveryStatus: null,
      linkDeliveryStartedAt: null,
    })
    .where(eq(namingReservations.id, seeded.reservationId));
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "already_issued",
  });
  assert.equal(mail.messages.length, 0);
});

test("two deliveries cannot create two active links", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Single send");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  mail.duringSend = async () => {
    mail.duringSend = undefined;
    started();
    await gate;
  };
  const service = deliveryService(mail);
  const first = service.deliver(seeded.reservationId);
  await startedPromise;
  const second = await service.deliver(seeded.reservationId);
  assert.equal(second.outcome, "in_progress");
  release();
  assert.equal((await first).outcome, "sent");
  assert.equal(mail.messages.length, 1);
  const reservation = await loadReservation(seeded.reservationId);
  assert.equal(
    reservation.namingTokenHash,
    hashNamingToken(tokenFrom(mail.messages[0]?.text ?? "")),
  );
});

test("delivery does nothing until Gmail settings are complete", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Unconfigured");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  const service = new NamingLinkDeliveryService(
    { db: database } as never,
    mail as never,
    {
      namingMailConfigured: false,
      namingResend: undefined,
      namingSmtp: undefined,
      namingPublicBaseUrl: undefined,
    } as EnvService,
    () => now,
  );
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "not_configured",
  });
  assert.equal(mail.messages.length, 0);
  assert.equal((await loadReservation(seeded.reservationId)).namingTokenHash, null);
});

test("Resend settings send one link without Gmail", {
  skip: !databaseUrl,
}, async () => {
  await clearDeliveryTables();
  const seeded = await insertClaimed("Resend item");
  await insertWebhook(seeded.bookingUuid, webhookPayload(seeded.bookingUuid));
  const mail = new FakeMail();
  const service = deliveryService(mail, {
    namingMailConfigured: true,
    namingResend: {
      apiKey: "re_test_key",
      from: "naming@send.example.com",
      replyTo: "marketing@example.com",
    },
    namingSmtp: undefined,
  });
  assert.deepEqual(await service.deliver(seeded.reservationId), {
    outcome: "sent",
  });
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.attempts[0]?.reservationId, seeded.reservationId);
  const token = tokenFrom(mail.messages[0]?.text ?? "");
  assert.equal(
    (await loadReservation(seeded.reservationId)).namingTokenHash,
    hashNamingToken(token),
  );
  assert.equal(JSON.stringify(mail.attempts).includes("re_test_key"), false);
});

class FakeMail {
  readonly messages: { to: string; subject: string; text: string }[] = [];
  readonly attempts: {
    reservationId?: string;
    to: string;
    subject: string;
    text: string;
  }[] = [];
  fail = false;
  duringSend: (() => Promise<void>) | undefined;

  async send(message: {
    reservationId?: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    this.attempts.push(message);
    if (this.duringSend) {
      await this.duringSend();
    }
    if (this.fail) {
      throw new Error("mailbox rejected the message");
    }
    this.messages.push(message);
  }
}

function deliveryService(
  mail: FakeMail,
  env: Record<string, unknown> = {},
): NamingLinkDeliveryService {
  return new NamingLinkDeliveryService(
    { db: database } as never,
    mail as never,
    {
      namingMailConfigured: true,
      namingSmtp: {
        user: "farm@example.com",
        appPassword: "test-app-password",
        from: "farm@example.com",
      },
      namingPublicBaseUrl: "https://names.example.com",
      ...env,
    } as EnvService,
    () => now,
  );
}

function giftCardDatabase() {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                provider: "fareharbor",
                duplicateOf: null,
                payload: {
                  booking: { availability: { item: { pk: 308290 } } },
                },
              },
            ],
          }),
        }),
      }),
    },
  };
}

function tokenFrom(text: string): string {
  const matched = text.match(/\/name\/([A-Za-z0-9_-]{43})/);
  assert.ok(matched);
  return matched[1] ?? "";
}

async function clearDeliveryTables(): Promise<void> {
  await database.delete(integrationEvents);
  await database
    .update(namingObjects)
    .set({
      status: "available",
      heldReservationId: null,
      claimedReservationId: null,
    });
  await database.delete(namingReservations);
  await database.delete(namingObjects);
}

async function insertClaimed(name: string): Promise<{
  reservationId: string;
  bookingUuid: string;
}> {
  const bookingUuid = randomUUID();
  const [object] = await database
    .insert(namingObjects)
    .values({
      name,
      description: "Temporary local test object.",
      priceAmount: 10000,
      currency: "CAD",
      status: "available",
    })
    .returning();
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: `ref-${bookingUuid}`,
      priceAmount: 10000,
      currency: "CAD",
      status: "claimed",
      claimedAt: now,
      fareharborBookingUuid: bookingUuid,
      paidAmount: 10000,
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "claimed", claimedReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));
  return { reservationId: reservation.id, bookingUuid };
}

async function insertReview(name: string): Promise<{ reservationId: string }> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name,
      description: "",
      priceAmount: 10000,
      currency: "CAD",
      status: "available",
    })
    .returning();
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: `review-${object.id}`,
      priceAmount: 10000,
      currency: "CAD",
      status: "needs_review",
      reviewReason: "amount_mismatch",
      holdExpiresAt: new Date(now.getTime() + 60_000),
      adminResolutionRequired: false,
    })
    .returning();
  return { reservationId: reservation.id };
}

async function insertHeld(name: string): Promise<{ reservationId: string }> {
  const [object] = await database
    .insert(namingObjects)
    .values({
      name,
      description: "",
      priceAmount: 10000,
      currency: "CAD",
      status: "available",
    })
    .returning();
  const [reservation] = await database
    .insert(namingReservations)
    .values({
      objectId: object.id,
      checkoutRef: `held-${object.id}`,
      priceAmount: 10000,
      currency: "CAD",
      status: "held",
      holdExpiresAt: new Date(now.getTime() + 60_000),
      adminResolutionRequired: false,
    })
    .returning();
  await database
    .update(namingObjects)
    .set({ status: "held", heldReservationId: reservation.id })
    .where(eq(namingObjects.id, object.id));
  return { reservationId: reservation.id };
}

async function insertWebhook(
  bookingUuid: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await database.insert(integrationEvents).values({
    provider: "fareharbor",
    eventType: "booking",
    externalEntityType: "booking",
    externalEntityId: bookingUuid,
    payload,
    payloadHash: randomUUID(),
    processingStatus: "completed",
  });
}

function webhookPayload(
  bookingUuid: string,
  overrides: { paidAmount?: number; refunds?: unknown[] } = {},
): Record<string, unknown> {
  const paidAmount = overrides.paidAmount ?? 10000;
  return {
    booking: {
      uuid: bookingUuid,
      pk: 900001,
      status: "booked",
      online_booking_references: `ref-${bookingUuid}`,
      availability: { item: { pk: 308290, name: "Gift Card" } },
      receipt_total: paidAmount,
      amount_paid: paidAmount,
      payments: [
        {
          pk: 900501,
          status: "succeeded",
          type: "card",
          currency: "cad",
          amount_paid: paidAmount,
          created_at: "2026-11-03T01:14:28-0500",
          refunds: overrides.refunds ?? [],
        },
      ],
      contact: { email: `  ${PURCHASER}  `, name: "Synthetic Purchaser" },
    },
  };
}

async function loadReservation(id: string) {
  const [reservation] = await database
    .select()
    .from(namingReservations)
    .where(eq(namingReservations.id, id));
  if (!reservation) {
    throw new Error("missing reservation");
  }
  return reservation;
}

function deliveryDatabaseUrl(): string | undefined {
  const url = process.env.NAMING_TEST_DATABASE_URL;
  if (!url) {
    return undefined;
  }
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("NAMING_TEST_DATABASE_URL must point at localhost");
  }
  if (parsed.pathname !== "/naming") {
    throw new Error("NAMING_TEST_DATABASE_URL must use the naming database");
  }
  parsed.pathname = "/naming_delivery";
  return parsed.toString();
}

async function ensureDeliveryDatabase(): Promise<void> {
  const adminUrl = process.env.NAMING_TEST_DATABASE_URL;
  if (!adminUrl) {
    return;
  }
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const existing = await admin<{ datname: string }[]>`
    select datname from pg_database where datname = 'naming_delivery'
  `;
  if (existing.length === 0) {
    await admin.unsafe("create database naming_delivery");
  }
  await admin.end({ timeout: 5 });
}
