import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { bookingPartyMembers, bookings } from "./bookings";
import { createdAt, timestamptz, updatedAt } from "./columns";
import { experiences, sessions } from "./experiences";

export const visits = pgTable(
  "visit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experienceId: uuid("experience_id"),
    sessionId: uuid("session_id"),
    bookingId: uuid("booking_id"),
    bookingPartyMemberId: uuid("booking_party_member_id"),
    visitedAt: timestamptz("visited_at"),
    status: text("status"),
    signed: boolean("signed"),
    isMinor: boolean("is_minor"),
    ageAtVisit: integer("age_at_visit"),
    ageBand: text("age_band"),
    city: text("city"),
    postal: text("postal"),
    referralSource: text("referral_source"),
    groupType: text("group_type"),
    groupSize: integer("group_size"),
    isRepeatVisitor: boolean("is_repeat_visitor"),
    marketingOptIn: boolean("marketing_opt_in"),
    matchConfidence: text("match_confidence"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("visit_session_visited_at_idx").on(table.sessionId, table.visitedAt),
    index("visit_booking_idx").on(table.bookingId),
    index("visit_visited_at_idx").on(table.visitedAt),
    index("visit_experience_idx").on(table.experienceId),
    foreignKey({
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
      name: "visit_experience_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
      name: "visit_session_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "visit_booking_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.bookingPartyMemberId],
      foreignColumns: [bookingPartyMembers.id],
      name: "visit_booking_party_member_id_fk",
    }).onDelete("restrict"),
  ],
);
