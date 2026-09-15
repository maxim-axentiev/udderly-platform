import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import { hashCanonicalJson } from "./wherewolf.hash";
import {
  extractRecordArray,
} from "./wherewolf.schema-audit";
import {
  sanitizeWherewolfGuest,
  sanitizeWherewolfReservation,
} from "./wherewolf.sanitize";
import { WherewolfService } from "./wherewolf.service";
import { farmDayRange, farmInclusiveRange } from "./wherewolf.range";
import {
  WHEREWOLF_GUEST_ENTITY,
  WHEREWOLF_PROVIDER,
  WHEREWOLF_RESERVATION_ENTITY,
} from "./wherewolf.constants";
import type { WherewolfJson, WherewolfUtcRange } from "./wherewolf.types";

export type WherewolfImportWindow =
  | { date: string }
  | { from: string; to: string };

export type WherewolfImportSummary = {
  dateBegin: string;
  dateEnd: string;
  reservationsFetched: number;
  guestsFetched: number;
  snapshotsInserted: number;
  snapshotsUnchanged: number;
};

@Injectable()
export class WherewolfImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WherewolfService) private readonly wherewolf: WherewolfService,
  ) {}

  async importWindow(window: WherewolfImportWindow): Promise<WherewolfImportSummary> {
    const range = toRange(window);
    const client = this.wherewolf.createClient();
    const reservationsPayload = await client.getReservations(range);
    const guestsPayload = await client.getGuestsByFilter(range, 10_000);

    return this.persistFetched(range, reservationsPayload, guestsPayload);
  }

  async persistFetched(
    range: WherewolfUtcRange,
    reservationsPayload: unknown,
    guestsPayload: unknown,
  ): Promise<WherewolfImportSummary> {
    const reservations = extractRecordArray(
      reservationsPayload as WherewolfJson,
      ["bookings"],
    );
    const guests = extractRecordArray(guestsPayload as WherewolfJson, [
      "guests",
      "data",
      "results",
    ]);

    const observedAt = new Date();
    let snapshotsInserted = 0;
    let snapshotsUnchanged = 0;

    for (const record of reservations) {
      const payload = sanitizeWherewolfReservation(record);
      const result = await this.persistSnapshot(
        WHEREWOLF_RESERVATION_ENTITY,
        payload,
        observedAt,
      );
      if (result === "inserted") {
        snapshotsInserted += 1;
      } else if (result === "unchanged") {
        snapshotsUnchanged += 1;
      }
    }

    for (const record of guests) {
      const payload = sanitizeWherewolfGuest(record);
      const result = await this.persistSnapshot(
        WHEREWOLF_GUEST_ENTITY,
        payload,
        observedAt,
      );
      if (result === "inserted") {
        snapshotsInserted += 1;
      } else if (result === "unchanged") {
        snapshotsUnchanged += 1;
      }
    }

    return {
      dateBegin: range.dateBegin,
      dateEnd: range.dateEnd,
      reservationsFetched: reservations.length,
      guestsFetched: guests.length,
      snapshotsInserted,
      snapshotsUnchanged,
    };
  }

  private async persistSnapshot(
    entityType: string,
    payload: Record<string, unknown> | undefined,
    observedAt: Date,
  ): Promise<"inserted" | "unchanged" | "skipped"> {
    const externalId =
      payload && typeof payload.id === "string" ? payload.id : undefined;
    if (!payload || !externalId) {
      return "skipped";
    }

    const payloadHash = hashCanonicalJson(payload);
    const existing = await this.database.db
      .select({ id: sourceSnapshots.id })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, entityType),
          eq(sourceSnapshots.externalId, externalId),
          eq(sourceSnapshots.payloadHash, payloadHash),
        ),
      )
      .limit(1);

    if (existing[0]) {
      return "unchanged";
    }

    await this.database.db.insert(sourceSnapshots).values({
      provider: WHEREWOLF_PROVIDER,
      entityType,
      externalId,
      observedAt,
      payload,
      payloadHash,
    });
    return "inserted";
  }
}

export function toRange(window: WherewolfImportWindow): WherewolfUtcRange {
  if ("date" in window) {
    return farmDayRange(window.date);
  }
  return farmInclusiveRange(window.from, window.to);
}
