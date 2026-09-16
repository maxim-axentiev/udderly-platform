export const FAREHARBOR_REPORT_TITLE = "Bookings";

export const FAREHARBOR_REPORT_HEADERS = [
  "Booking ID",
  "Cancelled?",
  "Last Booked At",
  "Last Booked By",
  "Cancelled At",
  "Item",
  "Availability",
  "Contact",
  "Phone",
  "Contact Language",
  "Country by phone",
  "Email",
  "Subscribed to Email?",
  "Booking Notes",
  "Booking Cancellation Notes",
  "# of Pax",
  "Online Booking Reference",
  "Subtotal",
  "Total Tax",
  "Total",
  "Total Tax Paid",
  "Total Paid",
  "Affiliate",
  "Agent",
  "Desk",
  "Invoice Total",
  "Payable to Affiliate",
  "Paid to Affiliate",
  "Receivable from Affiliate",
  "Received from Affiliate",
] as const;

const REQUIRED_HEADERS = [
  "Booking ID",
  "Item",
  "Availability",
  "# of Pax",
  "Last Booked At",
] as const;

export type FareharborReportParseFailure =
  | { outcome: "invalid_file"; reason: "title" | "headers" | "empty" };

export type FareharborReportRow = {
  bookingIdRaw: string;
  bookingPk: string;
  cancelled: boolean;
  lastBookedAtRaw: string;
  lastBookedBy: string;
  cancelledAtRaw: string;
  itemLabel: string;
  availabilityRaw: string;
  contactName: string;
  phone: string;
  email: string;
  subscribedToEmail: string;
  paxRaw: string;
};

export type FareharborReportParseSuccess = {
  outcome: "ok";
  rows: FareharborReportRow[];
};

export function parseFareharborBookingsCsv(
  content: string,
): FareharborReportParseSuccess | FareharborReportParseFailure {
  const records = parseCsvRecords(stripBom(content));
  if (records.length < 2) {
    return { outcome: "invalid_file", reason: "empty" };
  }

  const title = (records[0]?.[0] ?? "").trim();
  if (title !== FAREHARBOR_REPORT_TITLE) {
    return { outcome: "invalid_file", reason: "title" };
  }

  const header = (records[1] ?? []).map((cell) => cell.trim());
  const indexByHeader = new Map<string, number>();
  for (const [index, name] of header.entries()) {
    if (name && !indexByHeader.has(name)) {
      indexByHeader.set(name, index);
    }
  }
  for (const required of REQUIRED_HEADERS) {
    if (!indexByHeader.has(required)) {
      return { outcome: "invalid_file", reason: "headers" };
    }
  }

  const rows: FareharborReportRow[] = [];
  for (const record of records.slice(2)) {
    if (record.every((cell) => cell.trim() === "")) {
      continue;
    }
    const bookingIdRaw = cell(record, indexByHeader, "Booking ID");
    if (!bookingIdRaw) {
      continue;
    }
    rows.push({
      bookingIdRaw,
      bookingPk: normalizeFareharborReportBookingId(bookingIdRaw) ?? "",
      cancelled: cell(record, indexByHeader, "Cancelled?") === "Cancelled",
      lastBookedAtRaw: cell(record, indexByHeader, "Last Booked At"),
      lastBookedBy: cell(record, indexByHeader, "Last Booked By"),
      cancelledAtRaw: cell(record, indexByHeader, "Cancelled At"),
      itemLabel: cell(record, indexByHeader, "Item"),
      availabilityRaw: cell(record, indexByHeader, "Availability"),
      contactName: cell(record, indexByHeader, "Contact"),
      phone: cell(record, indexByHeader, "Phone"),
      email: cell(record, indexByHeader, "Email"),
      subscribedToEmail: cell(record, indexByHeader, "Subscribed to Email?"),
      paxRaw: cell(record, indexByHeader, "# of Pax"),
    });
  }

  return { outcome: "ok", rows };
}

export function normalizeFareharborReportBookingId(
  value: string,
): string | undefined {
  const digits = value.trim().replace(/^#/, "").replace(/,/g, "").trim();
  return /^\d+$/.test(digits) ? digits : undefined;
}

export function parseCsvRecords(content: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    field += char;
  }

  if (inQuotes || field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  return records;
}

function cell(
  record: string[],
  indexByHeader: Map<string, number>,
  header: string,
): string {
  const index = indexByHeader.get(header);
  if (index === undefined) {
    return "";
  }
  return (record[index] ?? "").trim();
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
