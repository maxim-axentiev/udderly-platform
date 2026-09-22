import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import {
  payments,
  refunds,
  saleLineItems,
  sales,
} from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  classifySquareOrderMoney,
  moneyAmount,
  netProcessingFeeCost,
} from "./square.commerce.money";
import {
  emptyReconcileTotals,
  evaluateSquareCommerceReconciliation,
  type SquareCommerceReconcileVerdict,
} from "./square.commerce.reconcile";
import {
  pickLatestSnapshots,
  reconcileRangeLabel,
  type SquareSnapshotRow,
} from "./square.commerce.snapshots";
import {
  INTERNAL_PAYMENT,
  INTERNAL_PRODUCT_VARIATION,
  INTERNAL_REFUND,
  INTERNAL_SALE,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_ORDER_ENTITY,
  SQUARE_PAYMENT_ENTITY,
  SQUARE_PROVIDER,
  SQUARE_REFUND_ENTITY,
} from "./square.constants";
import { squareFarmUtcRange, type SquareFarmWindow } from "./square.range";

@Injectable()
export class SquareCommerceReconcileService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async reconcileWindow(
    window: SquareFarmWindow,
  ): Promise<SquareCommerceReconcileVerdict> {
    const range = squareFarmUtcRange(window);
    const [orderRows, paymentRows, refundRows] = await Promise.all([
      this.loadSnapshots(SQUARE_ORDER_ENTITY),
      this.loadSnapshots(SQUARE_PAYMENT_ENTITY),
      this.loadSnapshots(SQUARE_REFUND_ENTITY),
    ]);
    const orders = pickLatestSnapshots(orderRows, SQUARE_ORDER_ENTITY, range);
    const paymentSnapshots = pickLatestSnapshots(
      paymentRows,
      SQUARE_PAYMENT_ENTITY,
      range,
    );
    const refundSnapshots = pickLatestSnapshots(
      refundRows,
      SQUARE_REFUND_ENTITY,
      range,
    );

    const totals = emptyReconcileTotals(reconcileRangeLabel(window));
    totals.sourceOrders = orders.length;
    totals.sourcePayments = paymentSnapshots.length;
    totals.sourceRefunds = refundSnapshots.length;

    const grossOrders: SquareSnapshotRow[] = [];
    for (const order of orders) {
      const classified = classifySquareOrderMoney(order.payload);
      if (classified.kind === "sale") {
        totals.grossSaleOrders += 1;
        totals.sourceGrossSaleTotal += classified.money.totalAmount;
        totals.sourceTax += classified.money.taxAmount;
        totals.sourceDiscount += classified.money.discountAmount;
        totals.sourceServiceCharge += classified.money.serviceChargeAmount;
        grossOrders.push(order);
        totals.sourceLineItems += nestedArray(order.payload.line_items).length;
      } else if (classified.kind === "return_only") {
        totals.returnOnlyOrders += 1;
      } else if (classified.kind === "return_adjustment_non_sale") {
        totals.returnAdjustmentNonSales += 1;
      } else {
        totals.invalidOrders += 1;
      }
    }

    const resolvedVariations = await this.resolvedExternalIds(
      SQUARE_ITEM_VARIATION_ENTITY,
      INTERNAL_PRODUCT_VARIATION,
    );
    for (const order of grossOrders) {
      for (const line of nestedArray(order.payload.line_items)) {
        const catalogObjectId = stringValue(line.catalog_object_id);
        if (catalogObjectId && !resolvedVariations.has(catalogObjectId)) {
          totals.unresolvedVariations += 1;
        }
      }
    }

    const saleIds = await this.resolvedInternalIds(
      SQUARE_ORDER_ENTITY,
      INTERNAL_SALE,
      grossOrders.map((row) => row.externalId),
    );
    totals.canonicalSales = saleIds.length;
    const saleMoney = await this.sumSales(saleIds);
    totals.canonicalSaleTotal = saleMoney.totalAmount;
    totals.canonicalTax = saleMoney.taxAmount;
    totals.canonicalDiscount = saleMoney.discountAmount;
    totals.canonicalServiceCharge = saleMoney.serviceChargeAmount;

    const lineCounts = await this.countLines(saleIds);
    totals.canonicalLineItems = lineCounts.total;
    totals.activeCanonicalLines = lineCounts.active;
    totals.inactiveCanonicalLines = lineCounts.inactive;

    for (const snapshot of paymentSnapshots) {
      totals.sourcePaymentAmount += nonNegative(
        moneyAmount(snapshot.payload.amount_money),
      );
      totals.sourceTips += nonNegative(moneyAmount(snapshot.payload.tip_money));
      const feeNet = netProcessingFeeCost(snapshot.payload.processing_fee);
      if (feeNet.status === "cost") {
        totals.sourceProcessingFees += feeNet.amount;
      }
    }
    const paymentIds = await this.resolvedInternalIds(
      SQUARE_PAYMENT_ENTITY,
      INTERNAL_PAYMENT,
      paymentSnapshots.map((row) => row.externalId),
    );
    totals.canonicalPayments = paymentIds.length;
    const paymentMoney = await this.sumPayments(paymentIds);
    totals.canonicalPaymentAmount = paymentMoney.amount;
    totals.canonicalTips = paymentMoney.tipAmount;
    totals.canonicalProcessingFees = paymentMoney.processingFeeAmount;

    for (const snapshot of refundSnapshots) {
      totals.sourceRefundAmount += nonNegative(
        moneyAmount(snapshot.payload.amount_money),
      );
    }
    const refundIds = await this.resolvedInternalIds(
      SQUARE_REFUND_ENTITY,
      INTERNAL_REFUND,
      refundSnapshots.map((row) => row.externalId),
    );
    totals.canonicalRefunds = refundIds.length;
    totals.canonicalRefundAmount = await this.sumRefunds(refundIds);

    return evaluateSquareCommerceReconciliation(totals);
  }

  private async loadSnapshots(entityType: string): Promise<SquareSnapshotRow[]> {
    return this.database.db
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
  }

  private async resolvedExternalIds(
    entityType: string,
    internalEntityType: string,
  ): Promise<Set<string>> {
    const rows = await this.database.db
      .select({ externalId: sourceIdentities.externalId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.internalEntityType, internalEntityType),
        ),
      );
    return new Set(
      rows
        .map((row) => row.externalId)
        .filter((id): id is string => Boolean(id)),
    );
  }

  private async resolvedInternalIds(
    entityType: string,
    internalEntityType: string,
    externalIds: string[],
  ): Promise<string[]> {
    if (externalIds.length === 0) {
      return [];
    }
    const rows = await this.database.db
      .select({
        externalId: sourceIdentities.externalId,
        internalEntityId: sourceIdentities.internalEntityId,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.internalEntityType, internalEntityType),
          inArray(sourceIdentities.externalId, externalIds),
        ),
      );
    const unique = new Set<string>();
    for (const row of rows) {
      if (row.internalEntityId) {
        unique.add(row.internalEntityId);
      }
    }
    return [...unique];
  }

  private async sumSales(saleIds: string[]): Promise<{
    totalAmount: number;
    taxAmount: number;
    discountAmount: number;
    serviceChargeAmount: number;
  }> {
    const empty = {
      totalAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      serviceChargeAmount: 0,
    };
    if (saleIds.length === 0) {
      return empty;
    }
    const rows = await this.database.db
      .select({
        totalAmount: sales.totalAmount,
        taxAmount: sales.taxAmount,
        discountAmount: sales.discountAmount,
        serviceChargeAmount: sales.serviceChargeAmount,
      })
      .from(sales)
      .where(inArray(sales.id, saleIds));
    return rows.reduce(
      (sum, row) => ({
        totalAmount: sum.totalAmount + row.totalAmount,
        taxAmount: sum.taxAmount + row.taxAmount,
        discountAmount: sum.discountAmount + row.discountAmount,
        serviceChargeAmount: sum.serviceChargeAmount + row.serviceChargeAmount,
      }),
      empty,
    );
  }

  private async countLines(saleIds: string[]): Promise<{
    total: number;
    active: number;
    inactive: number;
  }> {
    if (saleIds.length === 0) {
      return { total: 0, active: 0, inactive: 0 };
    }
    const rows = await this.database.db
      .select({ isActive: saleLineItems.isActive })
      .from(saleLineItems)
      .where(inArray(saleLineItems.saleId, saleIds));
    let active = 0;
    let inactive = 0;
    for (const row of rows) {
      if (row.isActive) {
        active += 1;
      } else {
        inactive += 1;
      }
    }
    return { total: rows.length, active, inactive };
  }

  private async sumPayments(paymentIds: string[]): Promise<{
    amount: number;
    tipAmount: number;
    processingFeeAmount: number;
  }> {
    const empty = { amount: 0, tipAmount: 0, processingFeeAmount: 0 };
    if (paymentIds.length === 0) {
      return empty;
    }
    const rows = await this.database.db
      .select({
        amount: payments.amount,
        tipAmount: payments.tipAmount,
        processingFeeAmount: payments.processingFeeAmount,
      })
      .from(payments)
      .where(inArray(payments.id, paymentIds));
    return rows.reduce<{
      amount: number;
      tipAmount: number;
      processingFeeAmount: number;
    }>(
      (sum, row) => ({
        amount: sum.amount + row.amount,
        tipAmount: sum.tipAmount + row.tipAmount,
        processingFeeAmount:
          sum.processingFeeAmount + (row.processingFeeAmount ?? 0),
      }),
      empty,
    );
  }

  private async sumRefunds(refundIds: string[]): Promise<number> {
    if (refundIds.length === 0) {
      return 0;
    }
    const rows = await this.database.db
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(inArray(refunds.id, refundIds));
    return rows.reduce((sum, row) => sum + row.amount, 0);
  }
}

function nestedArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}
