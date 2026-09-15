const GUEST_KEYS = new Set([
  "id",
  "pool",
  "status",
  "lastVisit",
  "tripTimeslot",
  "signed",
  "createdAt",
  "updatedAt",
  "reservationsID",
  "activities",
  "activitiesAsObjects",
  "city",
  "whereDidYouHearAboutUs",
  "marketing",
  "repeatCustomer",
  "groupSize",
  "groupType",
  "minor",
  "howManyPeople",
  "howManyTimesBeen",
  "friends",
  "bookingLabel",
  "aliases",
  "displayId",
]);

const RESERVATION_KEYS = new Set([
  "id",
  "dateBegin",
  "dateEnd",
  "status",
  "activities",
  "activitiesAsObjects",
  "aliases",
  "bookingLabel",
  "displayId",
  "reservationsID",
  "startTime",
  "startTimeLocal",
  "endTime",
  "pax",
  "paxCompleted",
]);

export function sanitizeWherewolfGuest(
  record: unknown,
): Record<string, unknown> | undefined {
  return sanitizeRecord(record, GUEST_KEYS);
}

export function sanitizeWherewolfReservation(
  record: unknown,
): Record<string, unknown> | undefined {
  return sanitizeRecord(record, RESERVATION_KEYS);
}

function sanitizeRecord(
  record: unknown,
  keys: Set<string>,
): Record<string, unknown> | undefined {
  if (!isPlainObject(record)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const value = sanitizeValue(key, record[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }

  const id = idValue(sanitized.id);
  if (!id) {
    return undefined;
  }
  sanitized.id = id;
  return sanitized;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (key === "signed") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (key === "activitiesAsObjects") {
    return sanitizeActivityObjects(value);
  }

  if (key === "activities") {
    return sanitizeActivities(value);
  }

  if (key === "aliases") {
    return sanitizeAliases(value);
  }

  if (
    key === "marketing" ||
    key === "repeatCustomer" ||
    key === "minor"
  ) {
    return typeof value === "boolean" ? value : undefined;
  }

  if (
    key === "groupSize" ||
    key === "howManyPeople" ||
    key === "howManyTimesBeen" ||
    key === "friends" ||
    key === "pax" ||
    key === "paxCompleted"
  ) {
    return integerValue(value);
  }

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function sanitizeActivityObjects(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const activities: Array<{ id: string; name?: string }> = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const id = idValue(entry.id);
    if (!id) {
      continue;
    }
    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : undefined;
    activities.push(name ? { id, name } : { id });
  }

  return activities.length > 0 ? activities : undefined;
}

function sanitizeActivities(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return typeof value === "string" || typeof value === "number"
      ? String(value)
      : undefined;
  }

  const items: Array<string | { id: string; name?: string }> = [];
  for (const entry of value) {
    if (typeof entry === "string" || typeof entry === "number") {
      const text = String(entry).trim();
      if (text) {
        items.push(text);
      }
      continue;
    }
    if (isPlainObject(entry)) {
      const id = idValue(entry.id);
      if (id) {
        const name =
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : undefined;
        items.push(name ? { id, name } : { id });
      }
    }
  }

  return items.length > 0 ? items : undefined;
}

function sanitizeAliases(value: unknown): unknown {
  if (!Array.isArray(value)) {
    const id = idValue(value);
    return id ? [id] : undefined;
  }

  const aliases: string[] = [];
  for (const entry of value) {
    const id = idValue(entry);
    if (id) {
      aliases.push(id);
    }
  }
  return aliases.length > 0 ? aliases : undefined;
}

function idValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function integerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
