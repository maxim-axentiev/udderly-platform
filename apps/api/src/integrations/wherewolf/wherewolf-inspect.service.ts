import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { experienceSourceMappings } from "../../database/schema/experiences";
import { sourceSnapshots } from "../../database/schema/source-snapshots";
import {
  WHEREWOLF_ACTIVITY_OBJECT_TYPE,
  WHEREWOLF_GUEST_ENTITY,
  WHEREWOLF_PROVIDER,
  WHEREWOLF_RESERVATION_ENTITY,
} from "./wherewolf.constants";
import {
  firstActivity,
  stringId,
  visitOccurrenceIdentity,
  visitOccurrenceInstant,
} from "./wherewolf.occurrence";
import { FARM_TIME_ZONE, farmDayRange, instantOnFarmDate } from "./wherewolf.range";

export type WherewolfInspectSummary = {
  farmDate: string;
  timeZone: string;
  dateBegin: string;
  dateEnd: string;
  guestSnapshots: number;
  visitDateUnknown: number;
  byStatus: Record<string, number>;
  withLastVisit: number;
  withTripTimeslot: number;
  signedTrue: number;
  signedFalse: number;
  signedAbsent: number;
  mappedActivity: number;
  unmappedActivity: number;
  withReservationId: number;
  sufficientOccurrenceIdentity: number;
  insufficientOccurrenceIdentity: number;
};

@Injectable()
export class WherewolfInspectService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async inspectDate(date: string): Promise<WherewolfInspectSummary> {
    const range = farmDayRange(date);
    const guests = await this.database.db
      .select({ payload: sourceSnapshots.payload })
      .from(sourceSnapshots)
      .where(
        and(
          eq(sourceSnapshots.provider, WHEREWOLF_PROVIDER),
          eq(sourceSnapshots.entityType, WHEREWOLF_GUEST_ENTITY),
        ),
      );
    const reservations = await this.latestReservations();
    const mappedActivities = await this.mappedActivityIds();

    const summary: WherewolfInspectSummary = {
      farmDate: date,
      timeZone: FARM_TIME_ZONE,
      dateBegin: range.dateBegin,
      dateEnd: range.dateEnd,
      guestSnapshots: 0,
      visitDateUnknown: 0,
      byStatus: {},
      withLastVisit: 0,
      withTripTimeslot: 0,
      signedTrue: 0,
      signedFalse: 0,
      signedAbsent: 0,
      mappedActivity: 0,
      unmappedActivity: 0,
      withReservationId: 0,
      sufficientOccurrenceIdentity: 0,
      insufficientOccurrenceIdentity: 0,
    };

    for (const row of guests) {
      const reservationId = stringId(row.payload.reservationsID);
      const reservation = reservationId
        ? reservations.get(reservationId)
        : undefined;
      const instant = visitOccurrenceInstant(row.payload, reservation);
      if (!instant) {
        summary.visitDateUnknown += 1;
        continue;
      }
      if (!instantOnFarmDate(instant, date)) {
        continue;
      }

      summary.guestSnapshots += 1;
      const status = stringId(row.payload.status) ?? "(none)";
      summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
      if (row.payload.lastVisit) {
        summary.withLastVisit += 1;
      }
      if (row.payload.tripTimeslot) {
        summary.withTripTimeslot += 1;
      }
      if (row.payload.signed === true) {
        summary.signedTrue += 1;
      } else if (row.payload.signed === false) {
        summary.signedFalse += 1;
      } else {
        summary.signedAbsent += 1;
      }
      const activity = firstActivity(row.payload);
      if (activity && mappedActivities.has(activity.id)) {
        summary.mappedActivity += 1;
      } else {
        summary.unmappedActivity += 1;
      }
      if (reservationId) {
        summary.withReservationId += 1;
      }
      const guestId = stringId(row.payload.id);
      const identity = guestId
        ? visitOccurrenceIdentity(guestId, row.payload, reservation)
        : undefined;
      if (identity) {
        summary.sufficientOccurrenceIdentity += 1;
      } else {
        summary.insufficientOccurrenceIdentity += 1;
      }
    }

    return summary;
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

  private async mappedActivityIds(): Promise<Set<string>> {
    const rows = await this.database.db
      .select({ externalId: experienceSourceMappings.externalId })
      .from(experienceSourceMappings)
      .where(
        and(
          eq(experienceSourceMappings.provider, WHEREWOLF_PROVIDER),
          eq(
            experienceSourceMappings.providerObjectType,
            WHEREWOLF_ACTIVITY_OBJECT_TYPE,
          ),
        ),
      );
    return new Set(rows.map((row) => row.externalId));
  }
}

export function formatWherewolfInspect(summary: WherewolfInspectSummary): string {
  const statusLines =
    Object.keys(summary.byStatus).length === 0
      ? ["  (none)"]
      : Object.entries(summary.byStatus)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([status, count]) => `  ${status}: ${count}`);

  return [
    "Wherewolf inspection",
    "",
    `Farm date: ${summary.farmDate} (${summary.timeZone})`,
    `Range: ${summary.dateBegin} <= t < ${summary.dateEnd} (UTC)`,
    "",
    `Guest snapshots: ${summary.guestSnapshots}`,
    `Visit date unknown (excluded): ${summary.visitDateUnknown}`,
    "",
    "By source status:",
    ...statusLines,
    "",
    `With lastVisit: ${summary.withLastVisit}`,
    `With tripTimeslot: ${summary.withTripTimeslot}`,
    `Signed true: ${summary.signedTrue}`,
    `Signed false: ${summary.signedFalse}`,
    `Signed absent/non-boolean: ${summary.signedAbsent}`,
    `Mapped activity: ${summary.mappedActivity}`,
    `Unmapped activity: ${summary.unmappedActivity}`,
    `With reservation id: ${summary.withReservationId}`,
    `Sufficient visit-occurrence identity: ${summary.sufficientOccurrenceIdentity}`,
    `Insufficient visit-occurrence identity: ${summary.insufficientOccurrenceIdentity}`,
    "",
    "Attendance: source status is copied and unconfirmed. signed=true is not attendance.",
  ].join("\n");
}
