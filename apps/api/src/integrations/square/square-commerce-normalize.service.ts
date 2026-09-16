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
import { SquareCommerceNormalizer } from "./square-commerce-normalizer";
import {
  instantInUtcRange,
  snapshotWindowInstant,
  squareFarmUtcRange,
  type SquareFarmWindow,
} from "./square.range";

export type SquareCommerceNormalizeSummary = {
  sales: number;
  lineItems: number;
  payments: number;
  refunds: number;
  unresolvedCatalogLines: number;
  unresolvedPayments: number;
  unresolvedRefunds: number;
  skippedStale: number;
  invalidProcessingFees: number;
  returnOnlyOrdersSkipped: number;
  invalidOrderMoneySkipped: number;
};

type LatestSnapshot = {
  id: string;
  externalId: string;
  payload: Record<string, unknown>;
  observedAt: Date;
};

@Injectable()
export class SquareCommerceNormalizeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SquareCommerceNormalizer)
    private readonly normalizer: SquareCommerceNormalizer,
  ) {}

  async applySnapshot(snapshotId: string) {
    return this.database.db.transaction(async (tx) => {
      return this.normalizer.applySnapshot(tx, snapshotId);
    });
  }

  async normalizeWindow(
    window: SquareFarmWindow,
  ): Promise<SquareCommerceNormalizeSummary> {
    const range = squareFarmUtcRange(window);
    const orders = await this.latestInRange(SQUARE_ORDER_ENTITY, range);
    const payments = await this.latestInRange(SQUARE_PAYMENT_ENTITY, range);
    const refunds = await this.latestInRange(SQUARE_REFUND_ENTITY, range);

    const summary: SquareCommerceNormalizeSummary = {
      sales: 0,
      lineItems: 0,
      payments: 0,
      refunds: 0,
      unresolvedCatalogLines: 0,
      unresolvedPayments: 0,
      unresolvedRefunds: 0,
      skippedStale: 0,
      invalidProcessingFees: 0,
      returnOnlyOrdersSkipped: 0,
      invalidOrderMoneySkipped: 0,
    };

    for (const snapshot of orders) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, snapshot.id);
      });
      if (result.outcome === "applied" && result.kind === "sale") {
        summary.sales += 1;
        summary.lineItems += result.lineItems ?? 0;
        summary.unresolvedCatalogLines += result.unresolvedCatalogLines ?? 0;
      } else if (result.outcome === "skipped_return_only") {
        summary.returnOnlyOrdersSkipped += 1;
      } else if (result.outcome === "skipped_invalid_order_money") {
        summary.invalidOrderMoneySkipped += 1;
      } else if (result.outcome === "skipped_stale") {
        summary.skippedStale += 1;
      }
    }

    for (const snapshot of payments) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, snapshot.id);
      });
      if (result.outcome === "applied" && result.kind === "payment") {
        summary.payments += 1;
        if (result.invalidProcessingFee) {
          summary.invalidProcessingFees += 1;
        }
      } else if (result.outcome === "unresolved_payment") {
        summary.unresolvedPayments += 1;
      } else if (result.outcome === "skipped_stale") {
        summary.skippedStale += 1;
      }
    }

    for (const snapshot of refunds) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, snapshot.id);
      });
      if (result.outcome === "applied" && result.kind === "refund") {
        summary.refunds += 1;
      } else if (result.outcome === "unresolved_refund") {
        summary.unresolvedRefunds += 1;
      } else if (result.outcome === "skipped_stale") {
        summary.skippedStale += 1;
      }
    }

    return summary;
  }

  private async latestInRange(
    entityType: string,
    range: { startAt: string; endAt: string },
  ): Promise<LatestSnapshot[]> {
    const rows = await this.database.db
      .select({
        id: sourceSnapshots.id,
        externalId: sourceSnapshots.externalId,
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, entityType),
        ),
      );

    const latest = new Map<string, LatestSnapshot>();
    for (const row of rows) {
      const windowInstant = snapshotWindowInstant(entityType, row.payload);
      if (!instantInUtcRange(windowInstant, range)) {
        continue;
      }
      const existing = latest.get(row.externalId);
      if (!existing) {
        latest.set(row.externalId, row);
        continue;
      }
      if (row.observedAt.getTime() > existing.observedAt.getTime()) {
        latest.set(row.externalId, row);
        continue;
      }
      if (row.observedAt.getTime() === existing.observedAt.getTime()) {
        const rowUpdated = timestampMs(row.payload.updated_at);
        const existingUpdated = timestampMs(existing.payload.updated_at);
        if (rowUpdated > existingUpdated) {
          latest.set(row.externalId, row);
        }
      }
    }
    return [...latest.values()];
  }
}

function timestampMs(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}
