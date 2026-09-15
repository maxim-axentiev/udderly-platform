import { SQUARE_SENSITIVE_NEST_KEYS } from "./square.constants";

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

function walkValue(
  path: string,
  value: unknown,
  stats: Map<string, MutableFieldAudit>,
  isRecordRoot: boolean,
): void {
  if (path) {
    note(stats, path, value);
  }

  const key = path.split(".").pop()?.replace(/\[\]$/, "") ?? "";
  if (SQUARE_SENSITIVE_NEST_KEYS.has(key) && isPlainObject(value)) {
    return;
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function nestedObject(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isPlainObject(value) ? value : undefined;
}

export function nestedArray(
  record: Record<string, unknown>,
  key: string,
): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

export function moneyAmount(value: unknown): number | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const amount = value.amount;
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return amount;
  }

  if (typeof amount === "string" && /^-?\d+$/.test(amount)) {
    return Number(amount);
  }

  return undefined;
}

export function moneyCurrency(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const currency = value.currency;
  return typeof currency === "string" ? currency : undefined;
}

export function formatMoney(amount: number | undefined, currency = "USD"): string {
  if (amount === undefined) {
    return "(none)";
  }

  return `${currency} ${(amount / 100).toFixed(2)}`;
}

export function populatedCount(
  records: Record<string, unknown>[],
  key: string,
): number {
  return records.filter((record) => Boolean(stringValue(record, key))).length;
}

export function distribution(
  values: Array<string | undefined>,
): Array<{ label: string; count: number; percent: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value && value.length > 0 ? value : "(empty)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const total = values.length;
  return [...counts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function percent(part: number, total: number): string {
  if (total === 0) {
    return "n/a";
  }

  return `${Math.round((part / total) * 1000) / 10}%`;
}

export function minMaxTimestamps(values: Array<string | undefined>): {
  min?: string;
  max?: string;
} {
  const present = values.filter((value): value is string => Boolean(value)).sort();
  return {
    min: present[0],
    max: present[present.length - 1],
  };
}

export function timestampRange(days: number, end = new Date()): {
  startAt: string;
  endAt: string;
} {
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

export function historicalRange(
  daysAgo: number,
  windowDays: number,
): {
  startAt: string;
  endAt: string;
} {
  const end = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return timestampRange(windowDays, end);
}
