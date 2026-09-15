import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./columns";
import { experiences, sessions } from "./experiences";
import { sourceIdentities } from "./source-identity";


export const bookings = pgTable(
  "booking",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id"),
    experienceId: uuid("experience_id"),
    status: text("status").notNull(),
    partySize: integer("party_size"),
    sourceType: text("source_type"),
    bookedAt: timestamptz("booked_at"),
    observedAt: timestamptz("observed_at").notNull().defaultNow(),
    cancelledAt: timestamptz("cancelled_at"),
    rebookedFromBookingId: uuid("rebooked_from_booking_id"),
    rebookedToBookingId: uuid("rebooked_to_booking_id"),
    isSuperseded: boolean("is_superseded").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("booking_session_idx").on(table.sessionId),
    index("booking_experience_idx").on(table.experienceId),
    index("booking_status_booked_at_idx").on(table.status, table.bookedAt),
    index("booking_booked_at_idx").on(table.bookedAt),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
      name: "booking_session_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
      name: "booking_experience_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.rebookedFromBookingId],
      foreignColumns: [table.id],
      name: "booking_rebooked_from_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.rebookedToBookingId],
      foreignColumns: [table.id],
      name: "booking_rebooked_to_fk",
    }).onDelete("restrict"),
  ],
);

export const bookingContacts = pgTable(
  "booking_contact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    emailMarketingOptIn: boolean("email_marketing_opt_in"),
    smsOptIn: boolean("sms_opt_in"),
    observedAt: timestamptz("observed_at").notNull().defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("booking_contact_booking_uidx").on(table.bookingId),
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "booking_contact_booking_id_fk",
    }).onDelete("restrict"),
  ],
);

export const bookingPartyMembers = pgTable(
  "booking_party_member",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull(),
    sourceIdentityId: uuid("source_identity_id"),
    customerType: text("customer_type"),
    checkinStatus: text("checkin_status"),
    sequence: integer("sequence"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("booking_party_member_booking_idx").on(table.bookingId),
    index("booking_party_member_source_identity_idx").on(table.sourceIdentityId),
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "booking_party_member_booking_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sourceIdentityId],
      foreignColumns: [sourceIdentities.id],
      name: "booking_party_member_source_identity_id_fk",
    }).onDelete("restrict"),
  ],
);
