import assert from "node:assert/strict";
import test from "node:test";
import {
  FAREHARBOR_REPORT_HEADERS,
  normalizeFareharborReportBookingId,
  parseFareharborBookingsCsv,
} from "./fareharbor-report.parse";

function csv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
        )
        .join(","),
    )
    .join("\n");
}

test("title and header parsing ignores the totals row", () => {
  const content = csv([
    ["Bookings"],
    [...FAREHARBOR_REPORT_HEADERS],
    bookingRow({
      bookingId: "#378957692",
      item: "SYNTHETIC Goat Recess",
      pax: "2",
    }),
    bookingRow({
      bookingId: "",
      item: "",
      pax: "334",
      availability: "",
      lastBookedAt: "",
    }),
  ]);

  const parsed = parseFareharborBookingsCsv(content);
  assert.equal(parsed.outcome, "ok");
  if (parsed.outcome !== "ok") {
    return;
  }
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.bookingPk, "378957692");
  assert.equal("notes" in parsed.rows[0], false);
  assert.equal("subtotal" in parsed.rows[0], false);
});

test("refuses a non-Bookings report title", () => {
  const parsed = parseFareharborBookingsCsv("Payments\nBooking ID\n");
  assert.equal(parsed.outcome, "invalid_file");
  if (parsed.outcome === "invalid_file") {
    assert.equal(parsed.reason, "title");
  }
});

test("refuses a missing required header", () => {
  const parsed = parseFareharborBookingsCsv("Bookings\nBooking ID,Item\n");
  assert.equal(parsed.outcome, "invalid_file");
  if (parsed.outcome === "invalid_file") {
    assert.equal(parsed.reason, "headers");
  }
});

test("normalizes hashed FareHarbor report booking ids", () => {
  assert.equal(normalizeFareharborReportBookingId("#378957692"), "378957692");
  assert.equal(normalizeFareharborReportBookingId("378957692"), "378957692");
  assert.equal(normalizeFareharborReportBookingId("#abc"), undefined);
});

function bookingRow(input: {
  bookingId: string;
  item: string;
  pax: string;
  availability?: string;
  lastBookedAt?: string;
}): string[] {
  const byHeader: Record<string, string> = {
    "Booking ID": input.bookingId,
    "Cancelled?": "No",
    "Last Booked At": input.lastBookedAt ?? "2026-09-12 02:00pm",
    "Last Booked By": "Online",
    "Cancelled At": "",
    Item: input.item,
    Availability: input.availability ?? "2026-09-12 @ 03:00pm",
    Contact: "SYNTHETIC Booker",
    Phone: "+10000000000",
    "Contact Language": "en",
    "Country by phone": "US",
    Email: "synthetic@example.invalid",
    "Subscribed to Email?": "Yes",
    "Booking Notes": "do not persist",
    "Booking Cancellation Notes": "also secret",
    "# of Pax": input.pax,
    "Online Booking Reference": "ABC",
    Subtotal: "80.00",
    "Total Tax": "0.00",
    Total: "80.00",
    "Total Tax Paid": "0.00",
    "Total Paid": "80.00",
    Affiliate: "",
    Agent: "",
    Desk: "",
    "Invoice Total": "80.00",
    "Payable to Affiliate": "",
    "Paid to Affiliate": "",
    "Receivable from Affiliate": "",
    "Received from Affiliate": "",
  };
  return FAREHARBOR_REPORT_HEADERS.map((header) => byHeader[header] ?? "");
}
