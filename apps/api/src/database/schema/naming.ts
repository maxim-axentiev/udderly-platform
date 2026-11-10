import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  boolean,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./columns";

const namingReservationKey: { id?: AnyPgColumn; objectId?: AnyPgColumn } = {};

function namingReservationForeignColumns(): [AnyPgColumn, AnyPgColumn] {
  if (!namingReservationKey.id || !namingReservationKey.objectId) {
    throw new Error("naming_reservation columns are not initialized");
  }
  return [namingReservationKey.id, namingReservationKey.objectId];
}

/**
 * Gift-card naming inventory. `published_at` null means unpublished.
 * Prices are CAD integer minor units (CA$20.00 = 2000).
 */
export const namingObjectStatuses = ["available", "held", "claimed"] as const;

export type NamingObjectStatus = (typeof namingObjectStatuses)[number];

export const namingObjects = pgTable(
  "naming_object",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    photoUrl: text("photo_url"),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull().default("CAD"),
    publishedAt: timestamptz("published_at"),
    status: text("status")
      .notNull()
      .default("available")
      .$type<NamingObjectStatus>(),
    heldReservationId: uuid("held_reservation_id"),
    claimedReservationId: uuid("claimed_reservation_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("naming_object_status_idx").on(table.status),
    index("naming_object_published_at_idx").on(table.publishedAt),
    check(
      "naming_object_name_present",
      sql`char_length(btrim(${table.name})) > 0`,
    ),
    check("naming_object_currency_cad", sql`${table.currency} = 'CAD'`),
    check(
      "naming_object_price_amount_nonneg",
      sql`${table.priceAmount} >= 0`,
    ),
    check(
      "naming_object_status",
      sql`${table.status} in ('available', 'held', 'claimed')`,
    ),
    check(
      "naming_object_hold_state",
      sql`(
        (${table.status} = 'available' and ${table.heldReservationId} is null and ${table.claimedReservationId} is null)
        or (${table.status} = 'held' and ${table.heldReservationId} is not null and ${table.claimedReservationId} is null)
        or (${table.status} = 'claimed' and ${table.claimedReservationId} is not null and ${table.heldReservationId} is null)
      )`,
    ),
    foreignKey({
      columns: [table.heldReservationId, table.id],
      foreignColumns: namingReservationForeignColumns(),
      name: "naming_object_held_reservation_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.claimedReservationId, table.id],
      foreignColumns: namingReservationForeignColumns(),
      name: "naming_object_claimed_reservation_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * One checkout attempt for a naming object.
 * `checkout_ref` is the FareHarbor `ref`. `naming_token_hash` stays null
 * until a naming link is issued. It is then a lowercase hex SHA-256 only.
 *
 * `needs_review` never has naming rights. `released_at` null means it still
 * holds the object; `released_at` set means the object is free and payment
 * details remain. A review hold must have `hold_expires_at` unless
 * `admin_resolution_required` is explicitly true. `payment_reversed` on
 * `needs_review` means the payment was refunded before naming rights were
 * granted. On `claimed`, it means a later refund did not remove the claim.
 *
 * `link_delivery_status` tracks one email attempt. `sending` stores no token
 * hash. `sent` stores the hash of the message the provider accepted. A crash
 * after acceptance leaves `sending` and a null hash until recovery stores a
 * replacement. The plaintext token is never a column.
 */
export const namingReservationStatuses = [
  "held",
  "released",
  "claimed",
  "needs_review",
] as const;

export type NamingReservationStatus =
  (typeof namingReservationStatuses)[number];

export const namingReviewReasons = [
  "amount_mismatch",
  "late_conflict",
  "duplicate_booking",
  "payment_reversed",
  "underpaid",
  "purchase_after_deadline",
  "payment_time_unverified",
] as const;

export const namingNoticeKinds = ["underpaid", "purchase_after_deadline"] as const;

export type NamingNoticeKind = (typeof namingNoticeKinds)[number];

export const namingLinkDeliveryStatuses = ["sending", "sent", "failed"] as const;

export type NamingLinkDeliveryStatus =
  (typeof namingLinkDeliveryStatuses)[number];

export type NamingReviewReason = (typeof namingReviewReasons)[number];

export const namingReservations = pgTable(
  "naming_reservation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    objectId: uuid("object_id").notNull(),
    checkoutRef: text("checkout_ref").notNull(),
    namingTokenHash: text("naming_token_hash"),
    priceAmount: integer("price_amount").notNull(),
    currency: text("currency").notNull().default("CAD"),
    status: text("status").notNull().$type<NamingReservationStatus>(),
    holdExpiresAt: timestamptz("hold_expires_at"),
    adminResolutionRequired: boolean("admin_resolution_required")
      .notNull()
      .default(false),
    releasedAt: timestamptz("released_at"),
    claimedAt: timestamptz("claimed_at"),
    fareharborBookingUuid: text("fareharbor_booking_uuid"),
    paidAmount: integer("paid_amount"),
    reviewReason: text("review_reason").$type<NamingReviewReason>(),
    submittedName: text("submitted_name"),
    namedAt: timestamptz("named_at"),
    linkDeliveryStatus: text("link_delivery_status").$type<NamingLinkDeliveryStatus>(),
    linkDeliveryStartedAt: timestamptz("link_delivery_started_at"),
    linkResendStatus: text("link_resend_status").$type<NamingLinkDeliveryStatus>(),
    linkResendStartedAt: timestamptz("link_resend_started_at"),
    linkResendCount: integer("link_resend_count").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("naming_reservation_id_object_uidx").on(table.id, table.objectId),
    uniqueIndex("naming_reservation_checkout_ref_uidx").on(table.checkoutRef),
    uniqueIndex("naming_reservation_booking_uuid_uidx").on(
      table.fareharborBookingUuid,
    ),
    uniqueIndex("naming_reservation_token_hash_uidx").on(
      table.namingTokenHash,
    ),
    uniqueIndex("naming_reservation_object_held_uidx")
      .on(table.objectId)
      .where(
        sql`${table.status} = 'held' or (${table.status} = 'needs_review' and ${table.releasedAt} is null)`,
      ),
    uniqueIndex("naming_reservation_object_claimed_uidx")
      .on(table.objectId)
      .where(sql`${table.status} = 'claimed'`),
    index("naming_reservation_object_idx").on(table.objectId),
    index("naming_reservation_held_expiry_idx")
      .on(table.holdExpiresAt)
      .where(
        sql`${table.status} = 'held' or (${table.status} = 'needs_review' and ${table.releasedAt} is null and ${table.adminResolutionRequired} = false)`,
      ),
    foreignKey({
      columns: [table.objectId],
      foreignColumns: [namingObjects.id],
      name: "naming_reservation_object_id_fk",
    }).onDelete("restrict"),
    check(
      "naming_reservation_status",
      sql`${table.status} in ('held', 'released', 'claimed', 'needs_review')`,
    ),
    check("naming_reservation_currency_cad", sql`${table.currency} = 'CAD'`),
    check(
      "naming_reservation_price_amount_nonneg",
      sql`${table.priceAmount} >= 0`,
    ),
    check(
      "naming_reservation_paid_amount_nonneg",
      sql`${table.paidAmount} is null or ${table.paidAmount} >= 0`,
    ),
    check(
      "naming_reservation_checkout_ref_present",
      sql`char_length(btrim(${table.checkoutRef})) > 0`,
    ),
    check(
      "naming_reservation_booking_uuid_present",
      sql`${table.fareharborBookingUuid} is null or char_length(btrim(${table.fareharborBookingUuid})) > 0`,
    ),
    check(
      "naming_reservation_token_hash_sha256",
      sql`${table.namingTokenHash} is null or ${table.namingTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "naming_reservation_name_pair",
      sql`(
        (${table.submittedName} is null and ${table.namedAt} is null)
        or (
          ${table.submittedName} is not null
          and ${table.namedAt} is not null
          and char_length(btrim(${table.submittedName})) > 0
        )
      )`,
    ),
    check(
      "naming_reservation_state",
      sql`(
        (
          ${table.status} = 'held'
          and ${table.releasedAt} is null
          and ${table.claimedAt} is null
          and ${table.fareharborBookingUuid} is null
          and ${table.paidAmount} is null
          and ${table.namingTokenHash} is null
          and ${table.submittedName} is null
          and ${table.namedAt} is null
          and ${table.reviewReason} is null
          and ${table.holdExpiresAt} is not null
          and ${table.adminResolutionRequired} = false
        )
        or (
          ${table.status} = 'released'
          and ${table.releasedAt} is not null
          and ${table.claimedAt} is null
          and ${table.fareharborBookingUuid} is null
          and ${table.paidAmount} is null
          and ${table.namingTokenHash} is null
          and ${table.submittedName} is null
          and ${table.namedAt} is null
          and ${table.reviewReason} is null
          and ${table.adminResolutionRequired} = false
        )
        or (
          ${table.status} = 'claimed'
          and ${table.claimedAt} is not null
          and ${table.releasedAt} is null
          and ${table.fareharborBookingUuid} is not null
          and ${table.paidAmount} is not null
          and ${table.adminResolutionRequired} = false
          and (
            ${table.reviewReason} is null
            or ${table.reviewReason} in ('payment_reversed', 'duplicate_booking')
          )
        )
        or (
          ${table.status} = 'needs_review'
          and ${table.releasedAt} is null
          and ${table.claimedAt} is null
          and ${table.namingTokenHash} is null
          and ${table.submittedName} is null
          and ${table.namedAt} is null
          and ${table.reviewReason} in ('amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed', 'underpaid', 'purchase_after_deadline', 'payment_time_unverified')
          and (
            ${table.adminResolutionRequired} = true
            or ${table.holdExpiresAt} is not null
          )
        )
        or (
          ${table.status} = 'needs_review'
          and ${table.releasedAt} is not null
          and ${table.claimedAt} is null
          and ${table.namingTokenHash} is null
          and ${table.submittedName} is null
          and ${table.namedAt} is null
          and ${table.reviewReason} in ('amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed', 'underpaid', 'purchase_after_deadline', 'payment_time_unverified')
        )
      )`,
    ),
    check(
      "naming_reservation_link_delivery_status",
      sql`${table.linkDeliveryStatus} is null or ${table.linkDeliveryStatus} in ('sending', 'sent', 'failed')`,
    ),
    check(
      "naming_reservation_link_delivery_state",
      sql`(
        (${table.linkDeliveryStatus} is null and ${table.linkDeliveryStartedAt} is null)
        or (
          ${table.status} = 'claimed'
          and ${table.linkDeliveryStatus} = 'sending'
          and ${table.linkDeliveryStartedAt} is not null
          and ${table.namingTokenHash} is null
        )
        or (
          ${table.status} = 'claimed'
          and ${table.linkDeliveryStatus} = 'failed'
          and ${table.linkDeliveryStartedAt} is not null
          and ${table.namingTokenHash} is null
        )
        or (
          ${table.status} = 'claimed'
          and ${table.linkDeliveryStatus} = 'sent'
          and ${table.linkDeliveryStartedAt} is not null
          and ${table.namingTokenHash} is not null
        )
      )`,
    ),
    check(
      "naming_reservation_link_resend_status",
      sql`${table.linkResendStatus} is null or ${table.linkResendStatus} in ('sending', 'sent', 'failed')`,
    ),
    check(
      "naming_reservation_link_resend_count",
      sql`${table.linkResendCount} >= 0`,
    ),
    check(
      "naming_reservation_link_resend_state",
      sql`(
        (
          ${table.linkResendStatus} is null
          and ${table.linkResendStartedAt} is null
          and ${table.linkResendCount} = 0
        )
        or (
          ${table.status} = 'claimed'
          and ${table.submittedName} is not null
          and ${table.namedAt} is not null
          and ${table.namingTokenHash} is not null
          and ${table.linkResendStartedAt} is not null
          and (
            (
              ${table.linkResendStatus} = 'sent'
              and ${table.linkResendCount} >= 1
            )
            or ${table.linkResendStatus} in ('sending', 'failed')
          )
        )
      )`,
    ),
  ],
);

export const namingNotices = pgTable(
  "naming_notice",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id").notNull(),
    kind: text("kind").notNull().$type<NamingNoticeKind>(),
    status: text("status").notNull().$type<NamingLinkDeliveryStatus>(),
    startedAt: timestamptz("started_at").notNull(),
    sentAt: timestamptz("sent_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    provider: text("provider"),
    lastError: text("last_error"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("naming_notice_reservation_kind_uidx").on(
      table.reservationId,
      table.kind,
    ),
    foreignKey({
      columns: [table.reservationId],
      foreignColumns: [namingReservations.id],
      name: "naming_notice_reservation_id_fk",
    }).onDelete("restrict"),
    check(
      "naming_notice_kind",
      sql`${table.kind} in ('underpaid', 'purchase_after_deadline')`,
    ),
    check(
      "naming_notice_status",
      sql`${table.status} in ('sending', 'sent', 'failed')`,
    ),
    check(
      "naming_notice_attempt_count_nonneg",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "naming_notice_state",
      sql`(
        (${table.status} in ('sending', 'failed') and ${table.sentAt} is null)
        or (${table.status} = 'sent' and ${table.sentAt} is not null)
      )`,
    ),
    check(
      "naming_notice_provider",
      sql`${table.provider} is null or ${table.provider} in ('resend', 'smtp')`,
    ),
  ],
);

export const namingNameRevisions = pgTable(
  "naming_name_revision",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id").notNull(),
    objectId: uuid("object_id").notNull(),
    previousName: text("previous_name").notNull(),
    correctedName: text("corrected_name").notNull(),
    createdAt,
  },
  (table) => [
    index("naming_name_revision_reservation_idx").on(table.reservationId),
    foreignKey({
      columns: [table.reservationId],
      foreignColumns: [namingReservations.id],
      name: "naming_name_revision_reservation_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.objectId],
      foreignColumns: [namingObjects.id],
      name: "naming_name_revision_object_id_fk",
    }).onDelete("restrict"),
    check(
      "naming_name_revision_previous_present",
      sql`char_length(btrim(${table.previousName})) > 0`,
    ),
    check(
      "naming_name_revision_corrected_present",
      sql`char_length(btrim(${table.correctedName})) > 0`,
    ),
  ],
);

namingReservationKey.id = namingReservations.id;
namingReservationKey.objectId = namingReservations.objectId;
