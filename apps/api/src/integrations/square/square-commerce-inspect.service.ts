import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  formatSquareCommerceInspect,
  inspectSquareOrderSnapshots,
  type SquareCommerceInspectSummary,
} from "./square.commerce.inspect";
import {
  pickLatestSnapshots,
  reconcileRangeLabel,
} from "./square.commerce.snapshots";
import { SQUARE_ORDER_ENTITY, SQUARE_PROVIDER } from "./square.constants";
import { squareFarmUtcRange, type SquareFarmWindow } from "./square.range";

@Injectable()
export class SquareCommerceInspectService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async inspectWindow(
    window: SquareFarmWindow,
  ): Promise<SquareCommerceInspectSummary> {
    const range = squareFarmUtcRange(window);
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
          eq(sourceSnapshots.entityType, SQUARE_ORDER_ENTITY),
        ),
      );
    const latest = pickLatestSnapshots(rows, SQUARE_ORDER_ENTITY, range);
    return inspectSquareOrderSnapshots(
      latest.map((row) => row.payload),
      reconcileRangeLabel(window),
    );
  }

  format(summary: SquareCommerceInspectSummary): string {
    return formatSquareCommerceInspect(summary);
  }
}
