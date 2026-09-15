import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  WHEREWOLF_GUEST_ENTITY,
  WHEREWOLF_PROVIDER,
  WHEREWOLF_RESERVATION_ENTITY,
} from "./wherewolf.constants";
import { instantOnFarmDate } from "./wherewolf.range";
import { WherewolfNormalizer } from "./wherewolf-normalizer";
import type { WherewolfNormalizeApplyResult } from "./wherewolf-normalizer";
import { stringId, visitOccurrenceInstant } from "./wherewolf.occurrence";

export type WherewolfNormalizeCommand =
  | { snapshotId: string }
  | { date: string };

export type WherewolfNormalizeRun = {
  farmDate?: string;
  skippedNoVisitDate: number;
  results: WherewolfNormalizeApplyResult[];
};

@Injectable()
export class WherewolfNormalizeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WherewolfNormalizer)
    private readonly normalizer: WherewolfNormalizer,
  ) {}

  async normalize(
    command: WherewolfNormalizeCommand,
  ): Promise<WherewolfNormalizeRun> {
    if ("snapshotId" in command) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, command.snapshotId);
      });
      return { skippedNoVisitDate: 0, results: [result] };
    }

    const selected = await this.guestSnapshotsForFarmDate(command.date);
    const results: WherewolfNormalizeApplyResult[] = [];
    for (const snapshotId of selected.ids) {
      const result = await this.database.db.transaction(async (tx) => {
        return this.normalizer.applySnapshot(tx, snapshotId);
      });
      results.push(result);
    }
    return {
      farmDate: command.date,
      skippedNoVisitDate: selected.skippedNoVisitDate,
      results,
    };
  }

  private async guestSnapshotsForFarmDate(date: string): Promise<{
    ids: string[];
    skippedNoVisitDate: number;
  }> {
    const guests = await this.database.db
      .select({
        id: sourceSnapshots.id,
        payload: sourceSnapshots.payload,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, WHEREWOLF_GUEST_ENTITY),
        ),
      );
    const reservations = await this.latestReservations();

    const ids: string[] = [];
    let skippedNoVisitDate = 0;
    for (const row of guests) {
      const reservationId = stringId(row.payload.reservationsID);
      const reservation = reservationId
        ? reservations.get(reservationId)
        : undefined;
      const instant = visitOccurrenceInstant(row.payload, reservation);
      if (!instant) {
        skippedNoVisitDate += 1;
        continue;
      }
      if (instantOnFarmDate(instant, date)) {
        ids.push(row.id);
      }
    }
    return { ids, skippedNoVisitDate };
  }

  private async latestReservations(): Promise<
    Map<string, Record<string, unknown>>
  > {
    const rows = await this.database.db
      .select({
        externalId: sourceSnapshots.externalId,
        payload: sourceSnapshots.payload,
        observedAt: sourceSnapshots.observedAt,
      })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, WHEREWOLF_RESERVATION_ENTITY),
        ),
      );

    const latest = new Map<
      string,
      { payload: Record<string, unknown>; observedAt: Date }
    >();
    for (const row of rows) {
      const existing = latest.get(row.externalId);
      if (!existing || row.observedAt.getTime() > existing.observedAt.getTime()) {
        latest.set(row.externalId, {
          payload: row.payload,
          observedAt: row.observedAt,
        });
      }
    }

    return new Map(
      [...latest.entries()].map(([id, value]) => [id, value.payload]),
    );
  }
}
