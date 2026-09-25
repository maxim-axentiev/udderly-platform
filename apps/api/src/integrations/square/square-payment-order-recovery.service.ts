import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceIdentities } from "../../database/schema/source-identity";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  INTERNAL_PAYMENT,
  SQUARE_ORDER_ENTITY,
  SQUARE_PAYMENT_ENTITY,
  SQUARE_PROVIDER,
} from "./square.constants";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import {
  discoverMissingPaymentOrderDependencies,
  formatPaymentOrderRecoveryDiscovery,
  formatPaymentOrderRecoveryResult,
  summarizeRetrievedOrders,
  type PaymentOrderRecoveryDiscovery,
  type PaymentOrderRecoveryPersistSummary,
} from "./square.commerce.payment-order-recovery";
import { pickLatestSnapshots } from "./square.commerce.snapshots";
import { squareFarmUtcRange, type SquareFarmWindow } from "./square.range";
import { SquareService } from "./square.service";

export type SquarePaymentOrderRecoveryResult = {
  dryRun: boolean;
  discovery: PaymentOrderRecoveryDiscovery;
  persist?: PaymentOrderRecoveryPersistSummary;
  report: string;
};

@Injectable()
export class SquarePaymentOrderRecoveryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SquareService) private readonly square: SquareService,
    @Inject(SquareCommerceImportService)
    private readonly commerceImport: SquareCommerceImportService,
  ) {}

  async recoverWindow(
    window: SquareFarmWindow,
    options: { dryRun?: boolean } = {},
  ): Promise<SquarePaymentOrderRecoveryResult> {
    const discovery = await this.discoverWindow(window);
    if (options.dryRun) {
      return {
        dryRun: true,
        discovery,
        report: `${formatPaymentOrderRecoveryDiscovery(discovery, window)}\n\nDry run only. No Square API calls. No data changed.`,
      };
    }

    const persist = await this.retrieveAndPersist(discovery, window);
    return {
      dryRun: false,
      discovery,
      persist,
      report: formatPaymentOrderRecoveryResult(discovery, persist, window),
    };
  }

  async discoverWindow(
    window: SquareFarmWindow,
  ): Promise<PaymentOrderRecoveryDiscovery> {
    const range = squareFarmUtcRange(window);
    const paymentRows = await this.database.db
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
          eq(sourceSnapshots.entityType, SQUARE_PAYMENT_ENTITY),
        ),
      );
    const payments = pickLatestSnapshots(
      paymentRows,
      SQUARE_PAYMENT_ENTITY,
      range,
    );

    const resolvedPayments = await this.database.db
      .select({ externalId: sourceIdentities.externalId })
      .from(sourceIdentities)
      .where(
        and(
          eq(sourceIdentities.provider, SQUARE_PROVIDER),
          eq(sourceIdentities.entityType, SQUARE_PAYMENT_ENTITY),
          eq(sourceIdentities.internalEntityType, INTERNAL_PAYMENT),
          isNotNull(sourceIdentities.internalEntityId),
        ),
      );
    const orderSnapshots = await this.database.db
      .select({ externalId: sourceSnapshots.externalId })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, SQUARE_PROVIDER),
          eq(sourceSnapshots.entityType, SQUARE_ORDER_ENTITY),
        ),
      );

    return discoverMissingPaymentOrderDependencies(payments, {
      resolvedPaymentIds: new Set(
        resolvedPayments
          .map((row) => row.externalId)
          .filter((id): id is string => Boolean(id)),
      ),
      orderSnapshotIds: new Set(
        orderSnapshots
          .map((row) => row.externalId)
          .filter((id): id is string => Boolean(id)),
      ),
    });
  }

  async persistRetrievedOrders(
    requestedIds: string[],
    returnedOrders: Record<string, unknown>[],
    window: SquareFarmWindow,
  ): Promise<PaymentOrderRecoveryPersistSummary> {
    const range = squareFarmUtcRange(window);
    const requested = new Set(requestedIds.filter((id) => id.length > 0));
    const matching = returnedOrders.filter((order) => {
      const id = typeof order.id === "string" ? order.id.trim() : "";
      return id.length > 0 && requested.has(id);
    });
    const summary = summarizeRetrievedOrders(requestedIds, matching, range);
    const persisted = await this.commerceImport.persistCommerceObjects({
      orders: matching,
    });
    return {
      ordersRequested: new Set(requestedIds.filter((id) => id.length > 0)).size,
      ordersReturned: summary.returnedIds.size,
      ordersMissing: summary.missingIds.length,
      snapshotsInserted: persisted.snapshotsInserted,
      snapshotsUnchanged: persisted.snapshotsUnchanged,
      closedAt: summary.closedAt,
    };
  }

  private async retrieveAndPersist(
    discovery: PaymentOrderRecoveryDiscovery,
    window: SquareFarmWindow,
  ): Promise<PaymentOrderRecoveryPersistSummary> {
    if (discovery.distinctMissingOrderIds.length === 0) {
      return {
        ordersRequested: 0,
        ordersReturned: 0,
        ordersMissing: 0,
        snapshotsInserted: 0,
        snapshotsUnchanged: 0,
        closedAt: {
          closedBeforeWindow: 0,
          closedInsideWindow: 0,
          closedAfterWindow: 0,
          missingClosedAt: 0,
        },
      };
    }

    const client = this.square.createClient();
    const returned = await client.batchRetrieveOrders(
      discovery.distinctMissingOrderIds,
    );
    return this.persistRetrievedOrders(
      discovery.distinctMissingOrderIds,
      returned,
      window,
    );
  }
}
