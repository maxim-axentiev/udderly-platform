import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  SQUARE_ORDER_ENTITY,
  SQUARE_PAYMENT_ENTITY,
  SQUARE_PROVIDER,
  SQUARE_REFUND_ENTITY,
} from "./square.constants";
import {
  sanitizeSquareOrder,
  sanitizeSquarePayment,
  sanitizeSquareRefund,
} from "./square.commerce.sanitize";
import { hashCanonicalJson } from "./square.hash";
import { squareFarmUtcRange, type SquareFarmWindow } from "./square.range";
import { SquareService } from "./square.service";

export type SquareCommerceImportSummary = {
  ordersFetched: number;
  paymentsFetched: number;
  refundsFetched: number;
  snapshotsInserted: number;
  snapshotsUnchanged: number;
  snapshotsSkipped: number;
};

@Injectable()
export class SquareCommerceImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SquareService) private readonly square: SquareService,
  ) {}

  async importWindow(
    window: SquareFarmWindow,
  ): Promise<SquareCommerceImportSummary> {
    const client = this.square.createClient();
    const range = squareFarmUtcRange(window);
    const [orders, payments, refunds] = await Promise.all([
      client.searchOrders(range, { dateField: "closed_at" }),
      client.listPayments(range),
      client.listRefunds(range),
    ]);
    return this.persistCommerceObjects({ orders, payments, refunds });
  }

  async persistCommerceObjects(input: {
    orders?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    refunds?: Record<string, unknown>[];
  }): Promise<SquareCommerceImportSummary> {
    const observedAt = new Date();
    const summary: SquareCommerceImportSummary = {
      ordersFetched: 0,
      paymentsFetched: 0,
      refundsFetched: 0,
      snapshotsInserted: 0,
      snapshotsUnchanged: 0,
      snapshotsSkipped: 0,
    };

    for (const order of input.orders ?? []) {
      const sanitized = sanitizeSquareOrder(order);
      if (!sanitized) {
        summary.snapshotsSkipped += 1;
        continue;
      }
      summary.ordersFetched += 1;
      await this.persist(SQUARE_ORDER_ENTITY, sanitized, observedAt, summary);
    }
    for (const payment of input.payments ?? []) {
      const sanitized = sanitizeSquarePayment(payment);
      if (!sanitized) {
        summary.snapshotsSkipped += 1;
        continue;
      }
      summary.paymentsFetched += 1;
      await this.persist(SQUARE_PAYMENT_ENTITY, sanitized, observedAt, summary);
    }
    for (const refund of input.refunds ?? []) {
      const sanitized = sanitizeSquareRefund(refund);
      if (!sanitized) {
        summary.snapshotsSkipped += 1;
        continue;
      }
      summary.refundsFetched += 1;
      await this.persist(SQUARE_REFUND_ENTITY, sanitized, observedAt, summary);
    }

    return summary;
  }

  private async persist(
    entityType: string,
    payload: Record<string, unknown>,
    observedAt: Date,
    summary: SquareCommerceImportSummary,
  ): Promise<void> {
    const externalId =
      typeof payload.id === "string" ? payload.id : undefined;
    if (!externalId) {
      summary.snapshotsSkipped += 1;
      return;
    }

    const payloadHash = hashCanonicalJson(payload);
    const existing = await this.database.db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, entityType),
          eq(sourceSnapshots.externalId, externalId),
          eq(sourceSnapshots.payloadHash, payloadHash),
        ),
      )
      .limit(1);

    if (existing[0]) {
      summary.snapshotsUnchanged += 1;
      return;
    }

    await this.database.db.insert(sourceSnapshots).values({
      provider: SQUARE_PROVIDER,
      entityType,
      externalId,
      observedAt,
      payload,
      payloadHash,
    });
    summary.snapshotsInserted += 1;
  }
}
