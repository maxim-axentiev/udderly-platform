import { and, eq, inArray, sql } from "drizzle-orm";
import { Injectable } from "@nestjs/common";
import type { AppDatabase } from "../../database/database.service";
import {
  payments,
  productVariations,
  refunds,
  saleLineItems,
  sales,
} from "../../database/schema/commerce";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  classifySquareOrderMoney,
  moneyAmount,
  moneyCurrency,
  netProcessingFeeCost,
} from "./square.commerce.money";
import { orderLineExternalId } from "./square.commerce.line";
import {
  squareOrderStatus,
  squarePaymentMethod,
  squarePaymentStatus,
  squareRefundStatus,
} from "./square.commerce.status";
import {
  INTERNAL_PAYMENT,
  INTERNAL_PRODUCT_VARIATION,
  INTERNAL_REFUND,
  INTERNAL_SALE,
  INTERNAL_SALE_LINE_ITEM,
  SQUARE_CUSTOMER_ENTITY,
  SQUARE_ITEM_VARIATION_ENTITY,
  SQUARE_ORDER_ENTITY,
  SQUARE_ORDER_LINE_ENTITY,
  SQUARE_PAYMENT_ENTITY,
  SQUARE_PROVIDER,
  SQUARE_REFUND_ENTITY,
  SQUARE_SALE_KIND_RETAIL,
} from "./square.constants";

export type SquareCommerceDb = Pick<
  AppDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export type SquareCommerceApplyResult =
  | {
      outcome: "applied";
      kind: "sale" | "payment" | "refund";
      unresolvedCatalogLines?: number;
      lineItems?: number;
      invalidProcessingFee?: boolean;
    }
  | { outcome: "skipped_stale" }
  | { outcome: "skipped_return_only" }
  | { outcome: "skipped_invalid_order_money" }
  | { outcome: "unresolved_payment" }
  | { outcome: "unresolved_refund" }
  | { outcome: "skipped"; reason: "invalid_payload" | "not_found" };

@Injectable()
export class SquareCommerceNormalizer {
  async applySnapshot(
    db: SquareCommerceDb,
    snapshotId: string,
  ): Promise<SquareCommerceApplyResult> {
    const [snapshot] = await db
      .select({
        id: sourceSnapshots.id,
        entityType: sourceSnapshots.entityType,
        externalId: sourceSnapshots.externalId,
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(eq(sourceSnapshots.id, snapshotId))
      .limit(1);

    if (!snapshot) {
      return { outcome: "skipped", reason: "not_found" };
    }
    if (await this.hasNewerSnapshot(db, snapshot)) {
      return { outcome: "skipped_stale" };
    }

    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`sq-com-${snapshot.entityType}-${snapshot.externalId}`}, 0))`,
    );

    if (snapshot.entityType === SQUARE_ORDER_ENTITY) {
      return this.applyOrder(db, snapshot);
    }
    if (snapshot.entityType === SQUARE_PAYMENT_ENTITY) {
      return this.applyPayment(db, snapshot);
    }
    if (snapshot.entityType === SQUARE_REFUND_ENTITY) {
      return this.applyRefund(db, snapshot);
    }
    return { outcome: "skipped", reason: "invalid_payload" };
  }

  private async hasNewerSnapshot(
    db: SquareCommerceDb,
    snapshot: {
      id: string;
      entityType: string;
      externalId: string;
      observedAt: Date;
      payload: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const rows = await db
      .select({
        id: sourceSnapshots.id,
        observedAt: sourceSnapshots.observedAt,
        payload: sourceSnapshots.payload,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, snapshot.entityType),
          eq(sourceSnapshots.externalId, snapshot.externalId),
        ),
      );

    const currentUpdated = timestampMs(snapshot.payload.updated_at);
    const currentVersion = numberValue(snapshot.payload.version) ?? 0;
    for (const row of rows) {
      if (row.id === snapshot.id) {
        continue;
      }
      if (row.observedAt.getTime() > snapshot.observedAt.getTime()) {
        return true;
      }
      if (row.observedAt.getTime() === snapshot.observedAt.getTime()) {
        const otherUpdated = timestampMs(row.payload.updated_at);
        if (otherUpdated > currentUpdated) {
          return true;
        }
        if (otherUpdated === currentUpdated) {
          const otherVersion = numberValue(row.payload.version) ?? 0;
          if (otherVersion > currentVersion) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private async applyOrder(
    db: SquareCommerceDb,
    snapshot: { externalId: string; payload: Record<string, unknown> },
  ): Promise<SquareCommerceApplyResult> {
    const classified = classifySquareOrderMoney(snapshot.payload);
    if (classified.kind === "return_only") {
      return { outcome: "skipped_return_only" };
    }
    if (classified.kind === "invalid_order_money") {
      return { outcome: "skipped_invalid_order_money" };
    }
    const money = classified.money;

    const status = squareOrderStatus(snapshot.payload.state);
    const source = nestedObject(snapshot.payload.source);
    const sourceType =
      stringValue(source?.name) ?? stringValue(source?.type);
    const occurredAt =
      parseInstant(snapshot.payload.closed_at) ??
      parseInstant(snapshot.payload.created_at);

    let saleId = await this.findResolved(
      db,
      SQUARE_ORDER_ENTITY,
      snapshot.externalId,
      INTERNAL_SALE,
    );

    const values = {
      kind: SQUARE_SALE_KIND_RETAIL,
      status,
      currency: money.currency,
      sourceType,
      subtotalAmount: money.subtotalAmount,
      discountAmount: money.discountAmount,
      taxAmount: money.taxAmount,
      serviceChargeAmount: money.serviceChargeAmount,
      totalAmount: money.totalAmount,
      occurredAt,
      updatedAt: new Date(),
    };

    if (saleId) {
      await db.update(sales).set(values).where(eq(sales.id, saleId));
    } else {
      const inserted = await db
        .insert(sales)
        .values(values)
        .returning({ id: sales.id });
      saleId = inserted[0]?.id;
      if (!saleId) {
        throw new Error("sale_insert_failed");
      }
    }

    await this.upsertIdentity(
      db,
      SQUARE_ORDER_ENTITY,
      snapshot.externalId,
      INTERNAL_SALE,
      saleId,
    );
    await this.ensureUnresolvedCustomer(
      db,
      stringValue(snapshot.payload.customer_id),
    );

    const lineResult = await this.syncLines(
      db,
      saleId,
      snapshot.externalId,
      snapshot.payload,
      money.currency,
    );
    return {
      outcome: "applied",
      kind: "sale",
      lineItems: lineResult.lineItems,
      unresolvedCatalogLines: lineResult.unresolvedCatalogLines,
    };
  }

  private async syncLines(
    db: SquareCommerceDb,
    saleId: string,
    orderId: string,
    payload: Record<string, unknown>,
    fallbackCurrency: string,
  ): Promise<{ lineItems: number; unresolvedCatalogLines: number }> {
    const rawLines = Array.isArray(payload.line_items)
      ? payload.line_items.filter(isPlainObject)
      : [];
    const seen = new Set<string>();
    let unresolvedCatalogLines = 0;
    const now = new Date();

    for (const [index, line] of rawLines.entries()) {
      const uid = stringValue(line.uid);
      const externalId = orderLineExternalId({
        orderId,
        version: payload.version,
        uid,
        index,
      });
      seen.add(externalId);

      const catalogObjectId = stringValue(line.catalog_object_id);
      const resolved = catalogObjectId
        ? await this.resolveVariation(db, catalogObjectId)
        : undefined;
      if (catalogObjectId && !resolved) {
        unresolvedCatalogLines += 1;
      }
      if (!catalogObjectId) {
        unresolvedCatalogLines += 1;
      }

      const currency =
        moneyCurrency(line.total_money) ??
        moneyCurrency(line.gross_sales_money) ??
        fallbackCurrency;
      const description = lineDescription(line);
      const quantity = quantityString(line.quantity);
      const grossAmount = nonNegativeMoney(
        moneyAmount(line.gross_sales_money) ??
          moneyAmount(line.variation_total_price_money),
      );
      const discountAmount = nonNegativeMoney(moneyAmount(line.total_discount_money));
      const taxAmount = nonNegativeMoney(moneyAmount(line.total_tax_money));
      const totalAmount = nonNegativeMoney(moneyAmount(line.total_money) ?? grossAmount);

      const existingId = await this.findResolved(
        db,
        SQUARE_ORDER_LINE_ENTITY,
        externalId,
        INTERNAL_SALE_LINE_ITEM,
      );

      const lineValues = {
        saleId,
        productId: resolved?.productId,
        productVariationId: resolved?.variationId,
        description,
        quantity,
        currency,
        grossAmount,
        discountAmount,
        taxAmount,
        totalAmount,
        isActive: true,
        lastSeenAt: now,
        removedAt: null as Date | null,
        updatedAt: now,
      };

      if (existingId) {
        await db
          .update(saleLineItems)
          .set(lineValues)
          .where(eq(saleLineItems.id, existingId));
        await this.upsertIdentity(
          db,
          SQUARE_ORDER_LINE_ENTITY,
          externalId,
          INTERNAL_SALE_LINE_ITEM,
          existingId,
        );
      } else {
        const inserted = await db
          .insert(saleLineItems)
          .values(lineValues)
          .returning({ id: saleLineItems.id });
        const id = inserted[0]?.id;
        if (!id) {
          throw new Error("sale_line_item_insert_failed");
        }
        await this.upsertIdentity(
          db,
          SQUARE_ORDER_LINE_ENTITY,
          externalId,
          INTERNAL_SALE_LINE_ITEM,
          id,
        );
      }
    }

    const existing = await db
      .select({
        id: saleLineItems.id,
      })
      .from(saleLineItems)
      .where(eq(saleLineItems.saleId, saleId));
    const existingIds = existing.map((row) => row.id);
    if (existingIds.length === 0) {
      return { lineItems: rawLines.length, unresolvedCatalogLines };
    }

    const identities = await db
      .select({
        externalId: sourceIdentities.externalId,
        internalEntityId: sourceIdentities.internalEntityId,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, SQUARE_ORDER_LINE_ENTITY),
          inArray(sourceIdentities.internalEntityId, existingIds),
        ),
      );

    for (const identity of identities) {
      if (!identity.internalEntityId || seen.has(identity.externalId)) {
        continue;
      }
      await db
        .update(saleLineItems)
        .set({
          isActive: false,
          removedAt: now,
          updatedAt: now,
        })
        .where(eq(saleLineItems.id, identity.internalEntityId));
    }

    return { lineItems: rawLines.length, unresolvedCatalogLines };
  }

  private async applyPayment(
    db: SquareCommerceDb,
    snapshot: { externalId: string; payload: Record<string, unknown> },
  ): Promise<SquareCommerceApplyResult> {
    const orderId = stringValue(snapshot.payload.order_id);
    if (!orderId) {
      return { outcome: "unresolved_payment" };
    }
    const saleId = await this.findResolved(
      db,
      SQUARE_ORDER_ENTITY,
      orderId,
      INTERNAL_SALE,
    );
    if (!saleId) {
      return { outcome: "unresolved_payment" };
    }

    const amount = nonNegativeMoney(moneyAmount(snapshot.payload.amount_money));
    const currency = moneyCurrency(snapshot.payload.amount_money);
    if (!currency) {
      return { outcome: "skipped", reason: "invalid_payload" };
    }
    const tipAmount = nonNegativeMoney(moneyAmount(snapshot.payload.tip_money));
    const feeNet = netProcessingFeeCost(snapshot.payload.processing_fee);
    let processingFeeAmount: number | undefined;
    let invalidProcessingFee = false;
    if (feeNet.status === "cost") {
      processingFeeAmount = feeNet.amount;
    } else if (feeNet.status === "invalid_net_credit") {
      invalidProcessingFee = true;
    }

    const values = {
      saleId,
      currency,
      amount,
      tipAmount,
      processingFeeAmount,
      status: squarePaymentStatus(snapshot.payload.status),
      method: squarePaymentMethod(snapshot.payload.source_type),
      paidAt: parseInstant(snapshot.payload.created_at),
      updatedAt: new Date(),
    };

    const existingId = await this.findResolved(
      db,
      SQUARE_PAYMENT_ENTITY,
      snapshot.externalId,
      INTERNAL_PAYMENT,
    );
    let paymentId = existingId;
    if (paymentId) {
      await db.update(payments).set(values).where(eq(payments.id, paymentId));
    } else {
      const inserted = await db
        .insert(payments)
        .values(values)
        .returning({ id: payments.id });
      paymentId = inserted[0]?.id;
      if (!paymentId) {
        throw new Error("payment_insert_failed");
      }
    }

    await this.upsertIdentity(
      db,
      SQUARE_PAYMENT_ENTITY,
      snapshot.externalId,
      INTERNAL_PAYMENT,
      paymentId,
    );
    await this.ensureUnresolvedCustomer(
      db,
      stringValue(snapshot.payload.customer_id),
    );
    return {
      outcome: "applied",
      kind: "payment",
      invalidProcessingFee,
    };
  }

  private async applyRefund(
    db: SquareCommerceDb,
    snapshot: { externalId: string; payload: Record<string, unknown> },
  ): Promise<SquareCommerceApplyResult> {
    const squarePaymentId = stringValue(snapshot.payload.payment_id);
    const squareOrderId = stringValue(snapshot.payload.order_id);
    const paymentId = squarePaymentId
      ? await this.findResolved(
          db,
          SQUARE_PAYMENT_ENTITY,
          squarePaymentId,
          INTERNAL_PAYMENT,
        )
      : undefined;

    let saleId: string | undefined;
    if (paymentId) {
      const [payment] = await db
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1);
      saleId = payment?.saleId;
    }
    if (!saleId && squareOrderId) {
      saleId = await this.findResolved(
        db,
        SQUARE_ORDER_ENTITY,
        squareOrderId,
        INTERNAL_SALE,
      );
    }
    if (!saleId && !paymentId) {
      return { outcome: "unresolved_refund" };
    }

    const amount = nonNegativeMoney(moneyAmount(snapshot.payload.amount_money));
    const currency = moneyCurrency(snapshot.payload.amount_money);
    if (!currency) {
      return { outcome: "skipped", reason: "invalid_payload" };
    }

    const values = {
      saleId,
      paymentId,
      currency,
      amount,
      status: squareRefundStatus(snapshot.payload.status),
      refundedAt: parseInstant(snapshot.payload.created_at),
      updatedAt: new Date(),
    };

    const existingId = await this.findResolved(
      db,
      SQUARE_REFUND_ENTITY,
      snapshot.externalId,
      INTERNAL_REFUND,
    );
    let refundId = existingId;
    if (refundId) {
      await db.update(refunds).set(values).where(eq(refunds.id, refundId));
    } else {
      const inserted = await db
        .insert(refunds)
        .values(values)
        .returning({ id: refunds.id });
      refundId = inserted[0]?.id;
      if (!refundId) {
        throw new Error("refund_insert_failed");
      }
    }

    await this.upsertIdentity(
      db,
      SQUARE_REFUND_ENTITY,
      snapshot.externalId,
      INTERNAL_REFUND,
      refundId,
    );
    return { outcome: "applied", kind: "refund" };
  }

  private async resolveVariation(
    db: SquareCommerceDb,
    catalogObjectId: string,
  ): Promise<{ variationId: string; productId: string } | undefined> {
    const variationId = await this.findResolved(
      db,
      SQUARE_ITEM_VARIATION_ENTITY,
      catalogObjectId,
      INTERNAL_PRODUCT_VARIATION,
    );
    if (!variationId) {
      return undefined;
    }
    const [row] = await db
      .select({
        id: productVariations.id,
        productId: productVariations.productId,
      })
      .from(productVariations)
      .where(eq(productVariations.id, variationId))
      .limit(1);
    if (!row) {
      return undefined;
    }
    return {
      variationId: row.id,
      productId: row.productId,
    };
  }

  private async ensureUnresolvedCustomer(
    db: SquareCommerceDb,
    customerId: string | undefined,
  ): Promise<void> {
    if (!customerId) {
      return;
    }
    const rows = await db
      .select({ id: sourceIdentities.id })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, SQUARE_CUSTOMER_ENTITY),
          eq(sourceIdentities.externalId, customerId),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return;
    }
    await db.insert(sourceIdentities).values({
      provider: SQUARE_PROVIDER,
      entityType: SQUARE_CUSTOMER_ENTITY,
      externalId: customerId,
      internalEntityType: null,
      internalEntityId: null,
    });
  }

  private async findResolved(
    db: SquareCommerceDb,
    entityType: string,
    externalId: string,
    internalEntityType: string,
  ): Promise<string | undefined> {
    const rows = await db
      .select({
        internalEntityId: sourceIdentities.internalEntityId,
        internalEntityType: sourceIdentities.internalEntityType,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (
      row?.internalEntityType === internalEntityType &&
      row.internalEntityId
    ) {
      return row.internalEntityId;
    }
    return undefined;
  }

  private async upsertIdentity(
    db: SquareCommerceDb,
    entityType: string,
    externalId: string,
    internalEntityType: string,
    internalEntityId: string,
  ): Promise<void> {
    const rows = await db
      .select({
        id: sourceIdentities.id,
        internalEntityId: sourceIdentities.internalEntityId,
      })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, entityType),
          eq(sourceIdentities.externalId, externalId),
        ),
      )
      .limit(1);

    if (rows[0]) {
      if (
        rows[0].internalEntityId &&
        rows[0].internalEntityId !== internalEntityId
      ) {
        throw new Error("square_commerce_identity_conflict");
      }
      await db
        .update(sourceIdentities)
        .set({
          internalEntityType,
          internalEntityId,
          updatedAt: new Date(),
        })
        .where(eq(sourceIdentities.id, rows[0].id));
      return;
    }

    await db.insert(sourceIdentities).values({
      provider: SQUARE_PROVIDER,
      entityType,
      externalId,
      internalEntityType,
      internalEntityId,
    });
  }
}

function lineDescription(line: Record<string, unknown>): string | undefined {
  const parts = [stringValue(line.name), stringValue(line.variation_name)];
  const modifiers = Array.isArray(line.modifiers)
    ? line.modifiers.filter(isPlainObject)
    : [];
  for (const modifier of modifiers) {
    const name = stringValue(modifier.name);
    if (name) {
      parts.push(name);
    }
  }
  const text = parts.filter(Boolean).join(" / ");
  return text || undefined;
}

function quantityString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value.toFixed(4);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed.toFixed(4);
    }
  }
  return "0.0000";
}

function nonNegativeMoney(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

function parseInstant(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time);
}

function timestampMs(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
