export type WherewolfActivity = {
  id: string;
  name?: string;
};

/**
 * Guest records often have only `activities: ["532251"]`.
 * Reservations may also have `activitiesAsObjects: [{ id, name }]`.
 * Prefer object ids/names, then string ids. Never invent names.
 */
export function extractWherewolfActivities(
  payload: Record<string, unknown>,
): WherewolfActivity[] {
  const byId = new Map<string, WherewolfActivity>();

  addActivityEntries(payload.activitiesAsObjects, byId);
  addActivityEntries(payload.activities, byId);

  return [...byId.values()];
}

export function firstActivity(
  payload: Record<string, unknown>,
): WherewolfActivity | undefined {
  return extractWherewolfActivities(payload)[0];
}

function addActivityEntries(
  value: unknown,
  byId: Map<string, WherewolfActivity>,
): void {
  if (value === undefined || value === null) {
    return;
  }

  if (!Array.isArray(value)) {
    addActivity(stringId(value), undefined, byId);
    return;
  }

  for (const entry of value) {
    if (typeof entry === "string" || typeof entry === "number") {
      addActivity(stringId(entry), undefined, byId);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const record = entry as { id?: unknown; name?: unknown };
    addActivity(stringId(record.id), stringId(record.name), byId);
  }
}

function addActivity(
  id: string | undefined,
  name: string | undefined,
  byId: Map<string, WherewolfActivity>,
): void {
  if (!id) {
    return;
  }
  const existing = byId.get(id);
  if (!existing) {
    byId.set(id, name ? { id, name } : { id });
    return;
  }
  if (!existing.name && name) {
    existing.name = name;
  }
}

function stringId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}
