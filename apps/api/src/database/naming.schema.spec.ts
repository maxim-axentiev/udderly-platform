import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  namingNameRevisions,
  namingNotices,
  namingObjects,
  namingReservations,
} from "./schema/naming";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle/0012_naming.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");
const deliveryMigrationSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../drizzle/0013_naming_link_delivery.sql"),
  "utf8",
);

const requiredNames = [
  "naming_object_name_present",
  "naming_object_currency_cad",
  "naming_object_price_amount_nonneg",
  "naming_object_status",
  "naming_object_hold_state",
  "naming_object_held_reservation_fk",
  "naming_object_claimed_reservation_fk",
  "naming_object_status_idx",
  "naming_object_published_at_idx",
  "naming_reservation_id_object_uidx",
  "naming_reservation_object_id_fk",
  "naming_reservation_status",
  "naming_reservation_currency_cad",
  "naming_reservation_price_amount_nonneg",
  "naming_reservation_paid_amount_nonneg",
  "naming_reservation_checkout_ref_present",
  "naming_reservation_booking_uuid_present",
  "naming_reservation_token_hash_sha256",
  "naming_reservation_name_pair",
  "naming_reservation_state",
  "naming_reservation_checkout_ref_uidx",
  "naming_reservation_booking_uuid_uidx",
  "naming_reservation_token_hash_uidx",
  "naming_reservation_object_held_uidx",
  "naming_reservation_object_claimed_uidx",
  "naming_reservation_object_idx",
  "naming_reservation_held_expiry_idx",
] as const;

test("naming migration declares the campaign constraints once", () => {
  for (const name of requiredNames) {
    assert.equal(
      migrationSql.split(`"${name}"`).length - 1,
      1,
      name,
    );
  }

  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX "naming_reservation_object_held_uidx".*WHERE "naming_reservation"\."status" = 'held' or \("naming_reservation"\."status" = 'needs_review' and "naming_reservation"\."released_at" is null\)/,
  );
  assert.match(
    migrationSql,
    /CREATE UNIQUE INDEX "naming_reservation_object_claimed_uidx".*WHERE "naming_reservation"\."status" = 'claimed'/,
  );
  assert.match(
    migrationSql,
    /CREATE INDEX "naming_reservation_held_expiry_idx".*admin_resolution_required" = false/,
  );
  assert.match(
    migrationSql,
    /"admin_resolution_required" boolean DEFAULT false NOT NULL/,
  );
  assert.match(
    migrationSql,
    /"hold_expires_at" timestamp with time zone,/,
  );
  assert.doesNotMatch(
    migrationSql,
    /"hold_expires_at" timestamp with time zone NOT NULL/,
  );
  assert.equal(
    migrationSql.split(
      "'amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed'",
    ).length - 1,
    2,
  );
  assert.match(
    migrationSql,
    /"status" = 'needs_review'\s+and "released_at" is null[\s\S]*?"naming_token_hash" is null[\s\S]*?"admin_resolution_required" = true\s+or "hold_expires_at" is not null/,
  );
  assert.match(
    migrationSql,
    /"status" = 'needs_review'\s+and "released_at" is not null[\s\S]*?"naming_token_hash" is null[\s\S]*?"submitted_name" is null[\s\S]*?"named_at" is null/,
  );
  assert.match(migrationSql, /"price_amount" integer NOT NULL/);
  assert.match(
    migrationSql,
    /"published_at" timestamp with time zone,/,
  );
  assert.doesNotMatch(migrationSql, /"published_at"[^\n]*DEFAULT/);
  assert.doesNotMatch(migrationSql, /email|phone|naming_token[^_]|token_plain/i);
  assert.match(
    migrationSql,
    /"naming_token_hash" is null or "naming_token_hash" ~ '\^\[0-9a-f\]\{64\}\$'/,
  );
  assert.doesNotMatch(migrationSql, /"naming_token_hash" is not null/);
});

test("link delivery migration keeps the token hash and omits purchaser details", () => {
  assert.equal(
    deliveryMigrationSql.split('"naming_reservation_link_delivery_status"').length - 1,
    1,
  );
  assert.equal(
    deliveryMigrationSql.split('"naming_reservation_link_delivery_state"').length - 1,
    1,
  );
  assert.match(
    deliveryMigrationSql,
    /"link_delivery_status" = 'sending'[\s\S]*?"naming_token_hash" is null/,
  );
  assert.match(
    deliveryMigrationSql,
    /"link_delivery_status" = 'sent'[\s\S]*?"naming_token_hash" is not null/,
  );
  assert.doesNotMatch(deliveryMigrationSql, /email|phone|token_plain/i);
});

test("naming drizzle tables expose the same constraint names", () => {
  const objectConfig = getTableConfig(namingObjects);
  const reservationConfig = getTableConfig(namingReservations);
  const names = new Set<string>([
    ...objectConfig.checks.map((check) => check.name),
    ...objectConfig.indexes.map((index) => index.config.name),
    ...objectConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ...reservationConfig.checks.map((check) => check.name),
    ...reservationConfig.indexes.map((index) => index.config.name),
    ...reservationConfig.uniqueConstraints.map((constraint) => constraint.name),
    ...reservationConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
  ]);

  for (const name of requiredNames) {
    assert.equal(names.has(name), true, name);
  }

  assert.equal(
    objectConfig.columns.some((column) => column.name === "published_at" && !column.notNull),
    true,
  );
  assert.equal(
    reservationConfig.columns.some((column) => column.name === "naming_token_hash"),
    true,
  );
  assert.equal(
    reservationConfig.columns.some((column) => column.name === "naming_token"),
    false,
  );
  assert.equal(
    reservationConfig.columns.some((column) => column.name === "email"),
    false,
  );
  assert.equal(
    reservationConfig.columns.some((column) => column.name === "link_delivery_status"),
    true,
  );
  assert.equal(names.has("naming_reservation_link_delivery_status"), true);
  assert.equal(names.has("naming_reservation_link_delivery_state"), true);
  const campaignSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../drizzle/0014_naming_campaign_rules.sql"),
    "utf8",
  );
  assert.match(campaignSql, /underpaid/);
  assert.match(campaignSql, /purchase_after_deadline/);
  assert.match(campaignSql, /payment_time_unverified/);
  assert.doesNotMatch(campaignSql, /email|phone|token_plain/i);
  const noticeNames = new Set(getTableConfig(namingNotices).columns.map((column) => column.name));
  const revisionNames = new Set(
    getTableConfig(namingNameRevisions).columns.map((column) => column.name),
  );
  assert.equal(noticeNames.has("email"), false);
  assert.equal(revisionNames.has("naming_token"), false);
  assert.equal(names.has("naming_reservation_link_resend_state"), true);
  const testObjectSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../drizzle/0016_naming_test_object.sql"),
    "utf8",
  );
  assert.match(testObjectSql, /ADD COLUMN "is_test" boolean DEFAULT false NOT NULL/);
  assert.match(testObjectSql, /lower\(btrim\("name"\)\) = 'test naming bucket'/);
  assert.equal(
    objectConfig.columns.some((column) => column.name === "is_test" && column.notNull),
    true,
  );
});
