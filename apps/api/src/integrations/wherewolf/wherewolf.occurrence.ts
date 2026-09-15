import { zonedLocalToUtc } from "./wherewolf.range";

export type WherewolfVisitOccurrence = {
  key: string;
  visitedAt?: Date;
};

export function visitOccurrenceIdentity(
  guestId: string,
  guest: Record<string, unknown>,
  reservation?: Record<string, unknown>,
): WherewolfVisitOccurrence | undefined {
  const reservationId = stringId(guest.reservationsID ?? reservation?.id);
  const visitedAt = visitOccurrenceInstant(guest, reservation);

  if (reservationId) {
    return {
      key: `${guestId}:r:${reservationId}`,
      visitedAt,
    };
  }

  if (visitedAt) {
    return {
      key: `${guestId}:t:${visitedAt.toISOString()}`,
      visitedAt,
    };
  }

  return undefined;
}

export function visitOccurrenceInstant(
  guest: Record<string, unknown>,
  reservation?: Record<string, unknown>,
): Date | undefined {
  return (
    parseSourceInstant(guest.lastVisit) ??
    parseSourceInstant(guest.tripTimeslot) ??
    parseSourceInstant(reservation?.startTime) ??
    parseSourceInstant(reservation?.startTimeLocal) ??
    parseSourceInstant(reservation?.dateBegin)
  );
}

export function firstActivity(
  payload: Record<string, unknown>,
): { id: string; name?: string } | undefined {
  const objects = payload.activitiesAsObjects;
  if (Array.isArray(objects)) {
    for (const entry of objects) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const id = stringId((entry as { id?: unknown }).id);
      if (id) {
        return { id, name: stringId((entry as { name?: unknown }).name) };
      }
    }
  }

  const activities = payload.activities;
  if (Array.isArray(activities)) {
    for (const entry of activities) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const id = stringId((entry as { id?: unknown }).id);
        if (id) {
          return {
            id,
            name: stringId((entry as { name?: unknown }).name),
          };
        }
      }
    }
  }

  return undefined;
}

export function stringId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function parseSourceInstant(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const text = value.trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return zonedLocalToUtc(text, 0, 0, 0);
  }

  const localMatch = text.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (
    localMatch?.[1] &&
    localMatch[2] &&
    localMatch[3] &&
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(text)
  ) {
    return zonedLocalToUtc(
      localMatch[1],
      Number(localMatch[2]),
      Number(localMatch[3]),
      Number(localMatch[4] ?? 0),
    );
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
