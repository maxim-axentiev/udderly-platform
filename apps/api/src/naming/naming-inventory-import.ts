import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, dirname } from "node:path";
import { PHOTO_MAX_BYTES } from "./naming-inventory.photo";

export const IMPORT_CONFIRMATION = "IMPORT-UNPUBLISHED";

export const PRODUCTION_IMPORT_CONFIRMATION = "IMPORT-PRODUCTION-UNPUBLISHED";

export const PROTECTED_OBJECT_NAMES = new Set(["Test Naming Bucket"]);

export const PROTECTED_OBJECT_IDS = new Set([
  "15898afd-b977-48b6-adb3-5a1eed602468",
]);

export const TIER_CENTS: Record<string, number> = {
  $100: 10_000,
  $250: 25_000,
  $500: 50_000,
  $1000: 100_000,
  "$1,000": 100_000,
};

const MANIFEST_HEADER = [
  "object_name",
  "description",
  "price_tier",
  "price_cad_cents",
  "original_photograph_path",
  "square_photograph_path",
  "image_processing_status",
  "matching_or_validation_notes",
  "import_readiness",
] as const;

const ORIGINAL_MAX_BYTES = 40 * 1024 * 1024;

export type ManifestRow = {
  line: number;
  name: string;
  description: string;
  tier: string;
  priceCents: number;
  originalPath: string;
  squarePath: string;
  processingStatus: string;
  notes: string;
  readiness: string;
};

export type ExistingObject = {
  id: string;
  name: string;
  description: string;
  photoUrl: string | null;
  priceCents: number;
  availability: string;
  published: boolean;
  isTest?: boolean;
};

export type InventoryApi = {
  list(): Promise<ExistingObject[]>;
  create(input: {
    name: string;
    description: string;
    priceCents: number;
  }): Promise<ExistingObject>;
  uploadPhoto(id: string, bytes: Buffer): Promise<ExistingObject>;
  readStaffPhoto(photoUrl: string): Promise<{ status: number; bytes: Buffer }>;
  readPublicPhoto(photoUrl: string): Promise<number>;
};

export type ReportRow = {
  line: number;
  name: string;
  tier: string;
  action: string;
  objectId: string | null;
  photograph: string;
  note: string;
};

export type ImportReport = {
  mode: "dry-run" | "execute";
  target: "local" | "production";
  duplicatesChecked: boolean;
  objects: number;
  ready: number;
  byTier: Record<string, { ready: number; review: number; invalid: number }>;
  skipped: Array<{ name: string; tier: string; reason: string }>;
  duplicates: Array<{ name: string; objectId: string; result: string }>;
  photographs: {
    validated: number;
    invalid: number;
    uploaded: number;
    missing: number;
  };
  untouched: Array<{
    id: string;
    name: string;
    availability: string;
    published: boolean;
  }>;
  rows: ReportRow[];
  failures: string[];
};

type Classified = {
  row: ManifestRow;
  action:
    | "review"
    | "invalid"
    | "protected"
    | "conflict"
    | "complete"
    | "attach"
    | "create"
    | "ambiguous";
  objectId: string | null;
  bytes: Buffer | null;
  photoInvalid: boolean;
  note: string;
};

export function parseManifest(text: string): ManifestRow[] {
  const table = parseCsv(text.replace(/^\uFEFF/, ""));
  const [header, ...records] = table;
  if (!header || header.join(",") !== MANIFEST_HEADER.join(",")) {
    throw new Error("Inventory manifest header does not match the expected columns.");
  }
  return records.map((record, index) => {
    if (record.length !== MANIFEST_HEADER.length) {
      throw new Error(`Inventory manifest row ${index + 2} has ${record.length} columns.`);
    }
    const price = Number(record[3]);
    return {
      line: index + 2,
      name: record[0] ?? "",
      description: record[1] ?? "",
      tier: record[2] ?? "",
      priceCents: Number.isInteger(price) ? price : Number.NaN,
      originalPath: record[4] ?? "",
      squarePath: record[5] ?? "",
      processingStatus: record[6] ?? "",
      notes: record[7] ?? "",
      readiness: record[8] ?? "",
    };
  });
}

export function readManifest(path: string): ManifestRow[] {
  return parseManifest(readFileSync(path, "utf8"));
}

export function assertImportHost(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Inventory base URL is not valid.");
  }
  if (url.username || url.password) {
    throw new Error("Put the staff password in NAMING_ADMIN_PASSWORD, not the base URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Inventory base URL must use http or https.");
  }
  if (!isLoopback(url.hostname)) {
    throw new Error("This importer only talks to a loopback API. Refusing remote host.");
  }
  return url;
}

export function readStaffPassword(env: NodeJS.ProcessEnv): string {
  const inline = env.NAMING_ADMIN_PASSWORD;
  if (inline && inline.length > 0) {
    return inline;
  }
  const file = env.NAMING_ADMIN_PASSWORD_FILE;
  if (file && file.length > 0) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error("Staff password file could not be read.");
    }
    const password = text.replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
    if (password.length > 0) {
      return password;
    }
  }
  throw new Error(
    "Staff password is not available. Set NAMING_ADMIN_PASSWORD or NAMING_ADMIN_PASSWORD_FILE.",
  );
}

export function classifyManifest(
  rows: ManifestRow[],
  existing: ExistingObject[],
  root: string,
): Classified[] {
  const duplicateNames = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.name)) {
      duplicateNames.add(row.name);
    }
    seen.add(row.name);
  }
  const byName = new Map<string, ExistingObject[]>();
  for (const object of existing) {
    const matches = byName.get(object.name) ?? [];
    matches.push(object);
    byName.set(object.name, matches);
  }
  return rows.map((row) => classifyRow(row, byName.get(row.name) ?? [], duplicateNames, root));
}

export function preflightManifest(
  manifestPath: string,
  root: string,
  progressPath: string,
  mode: "dry-run" | "execute",
  target: "local" | "production" = "local",
): ImportReport | undefined {
  const rows = readManifest(manifestPath);
  const classified = classifyManifest(rows, [], root);
  const problems = classified.filter(
    (item) => item.action === "invalid" || item.action === "ambiguous",
  );
  if (problems.length === 0) {
    return undefined;
  }
  const report = reportFrom(mode, rows, classified, [], false, target);
  report.failures.push("Validation failed. No inventory records were written.");
  for (const item of problems) {
    report.failures.push(`${item.row.name}: ${item.note}`);
  }
  writeProgress(progressPath, report);
  return report;
}

export async function runInventoryImport(options: {
  manifestPath: string;
  root: string;
  mode: "dry-run" | "execute";
  limit?: number;
  target?: "local" | "production";
  api: InventoryApi;
  progressPath: string;
}): Promise<ImportReport> {
  const target = options.target ?? "local";
  const blocked = preflightManifest(
    options.manifestPath,
    options.root,
    options.progressPath,
    options.mode,
    target,
  );
  if (blocked) {
    return blocked;
  }

  const rows = readManifest(options.manifestPath);
  const existing = await options.api.list();
  const classified = classifyManifest(rows, existing, options.root);
  const problems = classified.filter(
    (item) => item.action === "invalid" || item.action === "ambiguous",
  );
  if (problems.length > 0 || options.mode === "dry-run") {
    const report = reportFrom(options.mode, rows, classified, existing, true, target);
    if (problems.length > 0) {
      report.failures.push("Validation failed. No inventory records were written.");
      for (const item of problems) {
        report.failures.push(`${item.row.name}: ${item.note}`);
      }
    }
    writeProgress(options.progressPath, report);
    return report;
  }

  const report = reportFrom("execute", rows, classified, existing, true, target);
  writeProgress(options.progressPath, report);
  let readyOrdinal = 0;
  for (const item of classified) {
    if (item.row.readiness !== "ready") {
      continue;
    }
    readyOrdinal += 1;
    const output = report.rows.find((row) => row.line === item.row.line);
    if (!output) {
      continue;
    }
    if (options.limit !== undefined && readyOrdinal > options.limit) {
      output.action = "deferred";
      output.note = "Outside the requested import limit.";
      continue;
    }
    const persist = () => writeProgress(options.progressPath, report);
    if (item.action === "create") {
      await createAndUpload(options.api, item, output, report, persist);
    } else if (item.action === "attach") {
      await uploadExisting(options.api, item, output, report, persist);
    }
    persist();
    if (report.failures.length > 0) {
      break;
    }
  }
  writeProgress(options.progressPath, report);
  return report;
}

export function writeProgress(path: string, report: ImportReport): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(path, { force: true });
  renameSync(temporary, path);
}

function classifyRow(
  row: ManifestRow,
  matches: ExistingObject[],
  duplicateNames: Set<string>,
  root: string,
): Classified {
  const textIssue = validateText(row);
  if (row.readiness === "review") {
    return {
      row,
      action: textIssue ? "invalid" : "review",
      objectId: null,
      bytes: null,
      photoInvalid: false,
      note: textIssue ?? (row.notes || "Marked for review."),
    };
  }
  if (row.readiness !== "ready") {
    return {
      row,
      action: "invalid",
      objectId: null,
      bytes: null,
      photoInvalid: false,
      note: "Import readiness is neither ready nor review.",
    };
  }
  if (textIssue) {
    return {
      row,
      action: "invalid",
      objectId: null,
      bytes: null,
      photoInvalid: false,
      note: textIssue,
    };
  }
  if (duplicateNames.has(row.name)) {
    return {
      row,
      action: "ambiguous",
      objectId: null,
      bytes: null,
      photoInvalid: false,
      note: "The manifest uses this object name more than once.",
    };
  }
  if (PROTECTED_OBJECT_NAMES.has(row.name)) {
    const existing = matches[0];
    return {
      row,
      action: "protected",
      objectId: existing?.id ?? null,
      bytes: null,
      photoInvalid: false,
      note: "Protected object name. The row was not imported.",
    };
  }
  if (matches.length > 1) {
    return {
      row,
      action: "ambiguous",
      objectId: null,
      bytes: null,
      photoInvalid: false,
      note: "More than one existing object uses this name.",
    };
  }
  const files = loadPhotographs(row, root);
  if (files.issue) {
    return {
      row,
      action: "invalid",
      objectId: matches[0]?.id ?? null,
      bytes: null,
      photoInvalid: true,
      note: files.issue,
    };
  }
  const current = matches[0];
  if (!current) {
    return {
      row,
      action: "create",
      objectId: null,
      bytes: files.square,
      photoInvalid: false,
      note: "Create an unpublished object and upload the square photograph.",
    };
  }
  if (isProtected(current) || current.availability !== "available" || current.published) {
    return {
      row,
      action: "protected",
      objectId: current.id,
      bytes: null,
      photoInvalid: false,
      note: protectedNote(current),
    };
  }
  if (current.description !== row.description || current.priceCents !== row.priceCents) {
    return {
      row,
      action: "conflict",
      objectId: current.id,
      bytes: null,
      photoInvalid: false,
      note: "An existing object uses this name with different details. It was left unchanged.",
    };
  }
  if (current.photoUrl) {
    return {
      row,
      action: "complete",
      objectId: current.id,
      bytes: null,
      photoInvalid: false,
      note: "Matching unpublished object already has a photograph.",
    };
  }
  return {
    row,
    action: "attach",
    objectId: current.id,
    bytes: files.square,
    photoInvalid: false,
    note: "Matching unpublished object is missing its photograph.",
  };
}

function validateText(row: ManifestRow): string | undefined {
  if (row.name.trim() !== row.name || row.name.length === 0 || row.name.length > 120) {
    return "Object name is empty, padded, or longer than 120 characters.";
  }
  if (row.description.trim() !== row.description || row.description.length > 2000) {
    return "Description is padded or longer than 2000 characters.";
  }
  const expected = TIER_CENTS[row.tier];
  if (expected === undefined || row.priceCents !== expected) {
    return "Price tier does not match the CAD cent amount.";
  }
  return undefined;
}

function loadPhotographs(
  row: ManifestRow,
  root: string,
): { square: Buffer | null; issue?: string } {
  const original = resolvePhotoPath(root, row.originalPath);
  const square = resolvePhotoPath(root, row.squarePath);
  if (!original || !square) {
    return { square: null, issue: "Photograph path is missing or leaves the workspace." };
  }
  const originalIssue = inspectImage(original, ORIGINAL_MAX_BYTES);
  if (originalIssue) {
    return { square: null, issue: `Original photograph: ${originalIssue}` };
  }
  const squareIssue = inspectImage(square, PHOTO_MAX_BYTES);
  if (squareIssue) {
    return { square: null, issue: `Square photograph: ${squareIssue}` };
  }
  return { square: readFileSync(square) };
}

function inspectImage(path: string, maxBytes: number): string | undefined {
  let size = 0;
  try {
    const info = statSync(path);
    if (!info.isFile()) {
      return "path is not a file.";
    }
    size = info.size;
  } catch {
    return "file was not found.";
  }
  if (size <= 0 || size > maxBytes) {
    return "file is empty or larger than the allowed size.";
  }
  const bytes = readFileSync(path);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return "file is not a JPEG.";
  }
  return undefined;
}

export function resolvePhotoPath(root: string, photoPath: string): string | undefined {
  if (!photoPath || photoPath.includes("\0")) {
    return undefined;
  }
  const rootPath = resolve(root);
  const full = resolve(rootPath, photoPath);
  const remainder = relative(rootPath, full);
  if (remainder.startsWith("..") || isAbsolute(remainder)) {
    return undefined;
  }
  return full;
}

function isProtected(object: ExistingObject): boolean {
  return (
    object.isTest === true ||
    PROTECTED_OBJECT_IDS.has(object.id) ||
    PROTECTED_OBJECT_NAMES.has(object.name)
  );
}

function protectedNote(object: ExistingObject): string {
  if (PROTECTED_OBJECT_NAMES.has(object.name) || PROTECTED_OBJECT_IDS.has(object.id)) {
    return "Protected object. It was left unchanged.";
  }
  if (object.published) {
    return "Existing object is published. It was left unchanged.";
  }
  return `Existing object is ${object.availability}. It was left unchanged.`;
}

function reportFrom(
  mode: "dry-run" | "execute",
  rows: ManifestRow[],
  classified: Classified[],
  existing: ExistingObject[],
  duplicatesChecked: boolean,
  target: "local" | "production",
): ImportReport {
  const byTier: ImportReport["byTier"] = {};
  const skipped: ImportReport["skipped"] = [];
  const duplicates: ImportReport["duplicates"] = [];
  const reportRows: ReportRow[] = [];
  let ready = 0;
  let validated = 0;
  let invalidPhotos = 0;
  for (const item of classified) {
    const tier = byTier[item.row.tier] ?? { ready: 0, review: 0, invalid: 0 };
    if (item.action === "review") {
      tier.review += 1;
      skipped.push({ name: item.row.name, tier: item.row.tier, reason: item.note });
    } else if (item.action === "invalid" || item.action === "ambiguous") {
      tier.invalid += 1;
      skipped.push({ name: item.row.name, tier: item.row.tier, reason: item.note });
    } else {
      tier.ready += 1;
      ready += 1;
    }
    if (item.bytes) {
      validated += 1;
    }
    if (item.photoInvalid) {
      invalidPhotos += 1;
    }
    byTier[item.row.tier] = tier;
    const action = displayAction(mode, item.action);
    if (
      item.objectId &&
      (item.action === "complete" ||
        item.action === "attach" ||
        item.action === "conflict" ||
        item.action === "protected" ||
        item.action === "ambiguous")
    ) {
      duplicates.push({
        name: item.row.name,
        objectId: item.objectId,
        result: item.action,
      });
    }
    if (item.action === "protected" || item.action === "conflict" || item.action === "complete") {
      skipped.push({ name: item.row.name, tier: item.row.tier, reason: item.note });
    }
    reportRows.push({
      line: item.row.line,
      name: item.row.name,
      tier: item.row.tier,
      action,
      objectId: item.objectId,
      photograph: photographState(item),
      note: item.note,
    });
  }
  return {
    mode,
    target,
    duplicatesChecked,
    objects: rows.length,
    ready,
    byTier,
    skipped,
    duplicates,
    photographs: { validated, invalid: invalidPhotos, uploaded: 0, missing: 0 },
    untouched: existing
      .filter((object) => isProtected(object) || object.availability !== "available")
      .map((object) => ({
        id: object.id,
        name: object.name,
        availability: object.availability,
        published: object.published,
      })),
    rows: reportRows,
    failures: [],
  };
}

function displayAction(mode: "dry-run" | "execute", action: Classified["action"]): string {
  if (mode === "dry-run" && action === "create") {
    return "would-create";
  }
  if (mode === "dry-run" && action === "attach") {
    return "would-attach";
  }
  return action;
}

function photographState(item: Classified): string {
  if (item.action === "invalid") {
    return "invalid";
  }
  if (item.action === "complete") {
    return "already-present";
  }
  if (item.action === "attach" || item.action === "create") {
    return "validated";
  }
  return "not-applicable";
}

async function createAndUpload(
  api: InventoryApi,
  item: Classified,
  output: ReportRow,
  report: ImportReport,
  persist: () => void,
): Promise<void> {
  if (!item.bytes) {
    fail(report, output, "Square photograph was not loaded.");
    return;
  }
  let created: ExistingObject;
  try {
    created = await api.create({
      name: item.row.name,
      description: item.row.description,
      priceCents: item.row.priceCents,
    });
  } catch (error) {
    fail(report, output, safeError(error));
    return;
  }
  if (!createdAcceptable(created, item.row)) {
    output.objectId = created.id;
    output.action = "created-without-photograph";
    output.photograph = "missing";
    fail(report, output, "Created object did not match the manifest. Photograph upload was skipped.");
    return;
  }
  output.objectId = created.id;
  output.action = "created-without-photograph";
  output.photograph = "missing";
  report.photographs.missing += 1;
  persist();
  await uploadBytes(api, created.id, item.bytes, output, report, "created");
}

async function uploadExisting(
  api: InventoryApi,
  item: Classified,
  output: ReportRow,
  report: ImportReport,
  persist: () => void,
): Promise<void> {
  if (!item.objectId || !item.bytes) {
    fail(report, output, "Photograph recovery is missing the object or the file.");
    return;
  }
  output.objectId = item.objectId;
  output.photograph = "missing";
  report.photographs.missing += 1;
  persist();
  await uploadBytes(api, item.objectId, item.bytes, output, report, "attached");
}

async function uploadBytes(
  api: InventoryApi,
  id: string,
  bytes: Buffer,
  output: ReportRow,
  report: ImportReport,
  successAction: string,
): Promise<void> {
  let uploaded: ExistingObject;
  try {
    uploaded = await api.uploadPhoto(id, bytes);
  } catch (error) {
    output.note = "Object exists but the photograph was not uploaded. Rerun the import to attach it.";
    fail(report, output, safeError(error));
    return;
  }
  if (uploaded.id !== id || uploaded.published || uploaded.photoUrl === null) {
    output.note = "Photograph upload returned an unexpected object. It was not published by this importer.";
    fail(report, output, output.note);
    return;
  }
  output.action = successAction;
  output.objectId = uploaded.id;
  output.photograph = "uploaded";
  output.note = "Unpublished object has its square photograph.";
  report.photographs.uploaded += 1;
  report.photographs.missing = Math.max(0, report.photographs.missing - 1);
}

function createdAcceptable(object: ExistingObject, row: ManifestRow): boolean {
  return (
    object.published === false &&
    object.availability === "available" &&
    object.name === row.name &&
    object.description === row.description &&
    object.priceCents === row.priceCents &&
    object.photoUrl === null &&
    !isProtected(object)
  );
}

function fail(report: ImportReport, output: ReportRow, message: string): void {
  output.action = output.objectId ? "created-without-photograph" : "failed";
  report.failures.push(`${output.name}: ${message}`);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Inventory request failed.";
  return message.replace(/naming_inventory=[^;\s]+/g, "naming_inventory=[redacted]");
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }
  return rows;
}
