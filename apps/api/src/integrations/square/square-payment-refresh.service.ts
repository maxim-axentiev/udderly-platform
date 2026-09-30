import { Inject, Injectable } from "@nestjs/common";
import { SquareCommerceImportService } from "./square-commerce-import.service";
import { SquareService } from "./square.service";

export type SquarePaymentRefreshPersistSummary = {
  paymentsRequested: number;
  paymentsReturned: number;
  paymentsMissing: number;
  snapshotsInserted: number;
  snapshotsUnchanged: number;
};

@Injectable()
export class SquarePaymentRefreshService {
  constructor(
    @Inject(SquareService) private readonly square: SquareService,
    @Inject(SquareCommerceImportService)
    private readonly commerceImport: SquareCommerceImportService,
  ) {}

  async recoverExactPayments(
    paymentIds: string[],
  ): Promise<SquarePaymentRefreshPersistSummary> {
    const unique = [...new Set(paymentIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      return {
        paymentsRequested: 0,
        paymentsReturned: 0,
        paymentsMissing: 0,
        snapshotsInserted: 0,
        snapshotsUnchanged: 0,
      };
    }

    const client = this.square.createClient();
    const returned: Record<string, unknown>[] = [];
    let missing = 0;
    for (const paymentId of unique) {
      const payment = await client.retrievePayment(paymentId);
      if (!payment) {
        missing += 1;
        continue;
      }
      returned.push(payment);
    }

    const persisted = await this.commerceImport.persistCommerceObjects({
      payments: returned,
    });
    return {
      paymentsRequested: unique.length,
      paymentsReturned: returned.length,
      paymentsMissing: missing,
      snapshotsInserted: persisted.snapshotsInserted,
      snapshotsUnchanged: persisted.snapshotsUnchanged,
    };
  }
}

export function paymentRefreshCannotFulfill(
  summary: SquarePaymentRefreshPersistSummary,
): boolean {
  return (
    summary.paymentsRequested > 0 &&
    (summary.paymentsMissing > 0 || summary.paymentsReturned === 0)
  );
}
