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
  pickLatestSnapshots,
  type SquareSnapshotRow,
} from "./square.commerce.snapshots";
import {
  squareFarmUtcRange,
  type SquareFarmWindow,
} from "./square.range";

export type SquareCommerceNormalizeSummary = {
  sales: number;
  lineItems: number;
  payments: number;
  refunds: number;
  customNonCatalogLines: number;
  unresolvedCatalogLines: number;
  unresolvedPayments: number;
  unresolvedRefunds: number;
  skippedStale: number;
  invalidProcessingFees: number;
  returnOnlyOrdersSkipped: number;
  returnAdjustmentNonSalesSkipped: number;
  invalidOrderMoneySkipped: number;
  dependencyOrdersApplied: number;
  failedNonSettledPaymentAttemptsSkipped: number;
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
      customNonCatalogLines: 0,
      unresolvedCatalogLines: 0,
      unresolvedPayments: 0,
      unresolvedRefunds: 0,
      skippedStale: 0,
      invalidProcessingFees: 0,
      returnOnlyOrdersSkipped: 0,
      returnAdjustmentNonSalesSkipped: 0,
      invalidOrderMoneySkipped: 0,
      dependencyOrdersApplied: 0,
      failedNonSettledPaymentAttemptsSkipped: 0,
    };

    for (const snapshot of orders) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, snapshot.id);
      });
      if (result.outcome === "applied" && result.kind === "sale") {
        summary.sales += 1;
        summary.lineItems += result.lineItems ?? 0;
        summary.customNonCatalogLines += result.customNonCatalogLines ?? 0;
        summary.unresolvedCatalogLines += result.unresolvedCatalogLines ?? 0;
      } else if (result.outcome === "skipped_return_only") {
        summary.returnOnlyOrdersSkipped += 1;
      } else if (result.outcome === "skipped_return_adjustment_non_sale") {
        summary.returnAdjustmentNonSalesSkipped += 1;
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
        if (result.dependencyOrderApplied) {
          summary.dependencyOrdersApplied += 1;
        }
        summary.unresolvedCatalogLines += result.unresolvedCatalogLines ?? 0;
        summary.customNonCatalogLines += result.customNonCatalogLines ?? 0;
      } else if (result.outcome === "skipped_failed_non_settled_attempt") {
        summary.failedNonSettledPaymentAttemptsSkipped += 1;
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
  ): Promise<SquareSnapshotRow[]> {
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

    return pickLatestSnapshots(rows, entityType, range);
  }
}
