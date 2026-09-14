import type { WherewolfJson } from "./wherewolf.types";

export type FieldAudit = {
  path: string;
  types: string[];
  present: number;
  populated: number;
  populatedPercent: number;
};

type MutableFieldAudit = {
  path: string;
  types: Set<string>;
  present: number;
  populated: number;
};

export function envelopeShape(payload: WherewolfJson): {
  type: string;
  topLevelKeys: string[];
} {
  if (Array.isArray(payload)) {
    return { type: "array", topLevelKeys: [] };
  }

  if (payload && typeof payload === "object") {
    return {
      type: "object",
      topLevelKeys: Object.keys(payload).sort(),
    };
  }

  return { type: describeType(payload), topLevelKeys: [] };
}

export function extractRecordArray(
  payload: WherewolfJson,
  preferredKeys: string[],
): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    for (const key of preferredKeys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

export function auditRecords(records: unknown[]): FieldAudit[] {
  const stats = new Map<string, MutableFieldAudit>();

  for (const record of records) {
    walkValue("", record, stats, true);
  }

  return [...stats.values()]
    .map((entry) => ({
      path: entry.path,
      types: [...entry.types].sort(),
      present: entry.present,
      populated: entry.populated,
      populatedPercent:
        entry.present === 0
          ? 0
          : Math.round((entry.populated / entry.present) * 1000) / 10,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function partitionDocumentedFields(
  fields: FieldAudit[],
  documentedTopLevel: readonly string[],
): { documented: FieldAudit[]; additional: FieldAudit[] } {
  const documentedSet = new Set(documentedTopLevel);
  const documented: FieldAudit[] = [];
  const additional: FieldAudit[] = [];

  for (const field of fields) {
    const topLevel =
      field.path.split(".")[0]?.replace(/\[\]$/, "") ?? field.path;
    if (documentedSet.has(topLevel)) {
      documented.push(field);
    } else {
      additional.push(field);
    }
  }

  return { documented, additional };
}

function walkValue(
  path: string,
  value: unknown,
  stats: Map<string, MutableFieldAudit>,
  isRecordRoot: boolean,
): void {
  if (path) {
    note(stats, path, value);
  }

  if (Array.isArray(value)) {
    const itemPath = path ? `${path}[]` : "[]";
    for (const item of value) {
      note(stats, itemPath, item);
      if (isPlainObject(item)) {
        walkObject(itemPath, item, stats);
      }
    }
    return;
  }

  if (isPlainObject(value) && (path || isRecordRoot)) {
    walkObject(path, value, stats);
  }
}

function walkObject(
  path: string,
  value: Record<string, unknown>,
  stats: Map<string, MutableFieldAudit>,
): void {
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    walkValue(childPath, child, stats, false);
  }
}

function note(
  stats: Map<string, MutableFieldAudit>,
  path: string,
  value: unknown,
): void {
  const existing = stats.get(path) ?? {
    path,
    types: new Set<string>(),
    present: 0,
    populated: 0,
  };

  existing.present += 1;
  existing.types.add(describeType(value));
  if (isPopulated(value)) {
    existing.populated += 1;
  }

  stats.set(path, existing);
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (value === "") {
    return false;
  }

  if (Array.isArray(value) && value.length === 0) {
    return false;
  }

  if (isPlainObject(value) && Object.keys(value).length === 0) {
    return false;
  }

  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
