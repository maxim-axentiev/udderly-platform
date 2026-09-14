import { loadEnvFiles } from "../../config/load-env";
import { WherewolfClient } from "./wherewolf.client";
import {
  DOCUMENTED_BOOKING_FIELDS,
  DOCUMENTED_GUEST_FIELDS,
} from "./wherewolf.constants";
import { WherewolfApiError } from "./wherewolf.errors";
import {
  auditRecords,
  envelopeShape,
  extractRecordArray,
  partitionDocumentedFields,
  type FieldAudit,
} from "./wherewolf.schema-audit";
import { recentUtcRange } from "./wherewolf.range";
import type { WherewolfJson } from "./wherewolf.types";

const AUDIT_WINDOW_DAYS = 30;
const GUEST_AUDIT_LIMIT = 10_000;

async function main(): Promise<void> {
  loadEnvFiles();
  const apiKey = process.env.WHEREWOLF_API_KEY?.trim();
  const appId = process.env.WHEREWOLF_APP_ID?.trim();

  console.log("WHEREWOLF AUDIT");
  console.log("");

  console.log("Connection:");
  console.log(`- configured: ${apiKey && appId ? "yes" : "no"}`);

  if (!apiKey || !appId) {
    console.log("- API reachable: no (not configured)");
    console.log("");
    console.log(
      "Add WHEREWOLF_API_KEY and WHEREWOLF_APP_ID to the root .env file to run this audit.",
    );
    process.exitCode = 1;
    return;
  }

  const range = recentUtcRange(AUDIT_WINDOW_DAYS);
  console.log(`- window UTC: ${range.dateBegin} to ${range.dateEnd}`);
  console.log("- guest selection: cropped");
  console.log("- pool source: WHEREWOLF_APP_ID");

  const client = new WherewolfClient({
    apiKey,
    appId,
  });

  let bookingsPayload: WherewolfJson | undefined;
  let guestsPayload: WherewolfJson | undefined;
  let bookingsError: string | undefined;
  let guestsError: string | undefined;

  try {
    bookingsPayload = await client.getReservations(range);
  } catch (error) {
    bookingsError = safeFailure(error);
  }

  try {
    guestsPayload = await client.getGuestsByFilter(range, GUEST_AUDIT_LIMIT);
  } catch (error) {
    guestsError = safeFailure(error);
  }

  const reachable = Boolean(bookingsPayload) && Boolean(guestsPayload);
  console.log(`- API reachable: ${reachable ? "yes" : "no"}`);
  if (bookingsError) {
    console.log(`- reservations/get: ${bookingsError}`);
  }
  if (guestsError) {
    console.log(`- guest/getByFilter: ${guestsError}`);
  }

  if (bookingsPayload) {
    printCollection(
      "Bookings",
      "/reservations/get",
      bookingsPayload,
      ["bookings"],
      DOCUMENTED_BOOKING_FIELDS,
    );
  }

  if (guestsPayload) {
    printCollection(
      "Guests",
      "/guest/getByFilter",
      guestsPayload,
      ["guests", "data", "results"],
      DOCUMENTED_GUEST_FIELDS,
    );
    const guests = extractRecordArray(guestsPayload, [
      "guests",
      "data",
      "results",
    ]);
    if (guests.length >= GUEST_AUDIT_LIMIT) {
      console.log(
        `- note: guest request used limit ${GUEST_AUDIT_LIMIT}; more records may exist outside this sample.`,
      );
    }
  }

  if (!reachable) {
    process.exitCode = 1;
  }
}

function printCollection(
  label: string,
  endpoint: string,
  payload: WherewolfJson,
  arrayKeys: string[],
  documented: readonly string[],
): void {
  const envelope = envelopeShape(payload);
  const records = extractRecordArray(payload, arrayKeys);
  const fields = auditRecords(records);
  const { documented: documentedFields, additional } =
    partitionDocumentedFields(fields, documented);

  console.log("");
  console.log(`${label} (${endpoint}):`);
  console.log(`- number returned: ${records.length}`);
  console.log(`- response type: ${envelope.type}`);
  if (envelope.topLevelKeys.length > 0) {
    console.log(`- response keys: ${envelope.topLevelKeys.join(", ")}`);
  }
  printEnvelopeExtras(payload, arrayKeys);
  console.log(
    `- top-level field names: ${topLevelNames(fields).join(", ") || "(none)"}`,
  );
  console.log("- documented fields:");
  printFields(documentedFields);
  console.log("- additional fields (not listed in the public method docs):");
  printFields(additional);
}

function printEnvelopeExtras(
  payload: WherewolfJson,
  arrayKeys: string[],
): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return;
  }

  for (const key of Object.keys(payload).sort()) {
    if (arrayKeys.includes(key)) {
      continue;
    }

    const value = payload[key];
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    console.log(`- envelope.${key}: ${type}`);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nestedKeys = Object.keys(value).sort();
      if (nestedKeys.length > 0) {
        console.log(`  keys: ${nestedKeys.join(", ")}`);
      }
    }
  }
}

function printFields(fields: FieldAudit[]): void {
  if (fields.length === 0) {
    console.log("  (none)");
    return;
  }

  for (const field of fields) {
    console.log(
      `  - ${field.path}: ${field.types.join(" | ")}, populated ${field.populated}/${field.present} (${field.populatedPercent}%)`,
    );
  }
}

function topLevelNames(fields: FieldAudit[]): string[] {
  const names = new Set<string>();
  for (const field of fields) {
    if (!field.path.includes(".") && !field.path.includes("[]")) {
      names.add(field.path);
    }
  }
  return [...names].sort();
}

function safeFailure(error: unknown): string {
  if (error instanceof WherewolfApiError) {
    return error.message;
  }

  return "request failed";
}

void main().catch((error: unknown) => {
  console.error(safeFailure(error));
  process.exitCode = 1;
});
