import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./columns";
import { bookings } from "./bookings";
import { experiences, sessions } from "./experiences";

/**
 * Canonical retail category. Provider category ids live in `source_identity`
 * (e.g. square / category / <id>), not as this table's PK.
 */
export const productCategories = pgTable(
  "product_category",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt,
    updatedAt,
  },
  (table) => [index("product_category_status_idx").on(table.status)],
);

/**
 * Canonical catalog item. Archive in place (`status`); do not delete history.
 */
export const products = pgTable(
  "product",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt,
    updatedAt,
  },
  (table) => [index("product_status_idx").on(table.status)],
);

/**
 * Many-to-many product ↔ category. Square items can belong to multiple categories.
 * No primary category. Provider category ids stay on `source_identity`.
 */
export const productCategoryAssignments = pgTable(
  "product_category_assignment",
  {
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({
      name: "product_category_assignment_pk",
      columns: [table.productId, table.categoryId],
    }),
    index("product_category_assignment_category_idx").on(table.categoryId),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: "product_category_assignment_product_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [productCategories.id],
      name: "product_category_assignment_category_id_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * Sellable variation. SKU is not globally unique; many Square variations have none.
 * Provider ITEM_VARIATION ids live in `source_identity`.
 */
export const productVariations = pgTable(
  "product_variation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull(),
    name: text("name"),
    sku: text("sku"),
    status: text("status").notNull().default("active"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("product_variation_product_idx").on(table.productId),
    index("product_variation_sku_idx").on(table.sku),
    index("product_variation_status_idx").on(table.status),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: "product_variation_product_id_fk",
    }).onDelete("restrict"),
  ],
);

/**
 * Commercial sale document (revenue). Not a provider "order".
 * Money columns are integer minor units (CAD $12.34 = 1234) plus ISO currency.
 * `total_amount` is canonical sale value and excludes staff gratuity.
 * Do not add `sale.total_amount` + `payment.amount` for revenue.
 */
export const sales = pgTable(
  "sale",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    bookingId: uuid("booking_id"),
    experienceId: uuid("experience_id"),
    sessionId: uuid("session_id"),
    sourceType: text("source_type"),
    subtotalAmount: integer("subtotal_amount").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    serviceChargeAmount: integer("service_charge_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull(),
    occurredAt: timestamptz("occurred_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("sale_booking_uidx").on(table.bookingId),
    index("sale_status_occurred_idx").on(table.status, table.occurredAt),
    index("sale_experience_occurred_idx").on(
      table.experienceId,
      table.occurredAt,
    ),
    index("sale_kind_occurred_idx").on(table.kind, table.occurredAt),
    foreignKey({
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
      name: "sale_booking_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
      name: "sale_experience_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [sessions.id],
      name: "sale_session_id_fk",
    }).onDelete("restrict"),
    check(
      "sale_currency_len",
      sql`char_length(${table.currency}) = 3`,
    ),
    check("sale_subtotal_amount_nonneg", sql`${table.subtotalAmount} >= 0`),
    check("sale_discount_amount_nonneg", sql`${table.discountAmount} >= 0`),
    check("sale_tax_amount_nonneg", sql`${table.taxAmount} >= 0`),
    check(
      "sale_service_charge_amount_nonneg",
      sql`${table.serviceChargeAmount} >= 0`,
    ),
    check("sale_total_amount_nonneg", sql`${table.totalAmount} >= 0`),
    check(
      "sale_experience_has_booking",
      sql`${table.kind} <> 'experience' or ${table.bookingId} is not null`,
    ),
  ],
);

/**
 * What was sold. Product FKs are optional: historical lines may lack a catalog map.
 * Quantity is numeric because Square sends decimal quantity strings (not integers only).
 */
export const saleLineItems = pgTable(
  "sale_line_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id").notNull(),
    productId: uuid("product_id"),
    productVariationId: uuid("product_variation_id"),
    experienceId: uuid("experience_id"),
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    grossAmount: integer("gross_amount").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    totalAmount: integer("total_amount").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("sale_line_item_sale_idx").on(table.saleId),
    index("sale_line_item_product_idx").on(table.productId),
    index("sale_line_item_product_variation_idx").on(table.productVariationId),
    foreignKey({
      columns: [table.saleId],
      foreignColumns: [sales.id],
      name: "sale_line_item_sale_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.id],
      name: "sale_line_item_product_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.productVariationId],
      foreignColumns: [productVariations.id],
      name: "sale_line_item_product_variation_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.experienceId],
      foreignColumns: [experiences.id],
      name: "sale_line_item_experience_id_fk",
    }).onDelete("restrict"),
    check(
      "sale_line_item_currency_len",
      sql`char_length(${table.currency}) = 3`,
    ),
    check("sale_line_item_gross_amount_nonneg", sql`${table.grossAmount} >= 0`),
    check(
      "sale_line_item_discount_amount_nonneg",
      sql`${table.discountAmount} >= 0`,
    ),
    check("sale_line_item_tax_amount_nonneg", sql`${table.taxAmount} >= 0`),
    check("sale_line_item_total_amount_nonneg", sql`${table.totalAmount} >= 0`),
    check("sale_line_item_quantity_nonneg", sql`${table.quantity} >= 0`),
  ],
);

/**
 * Money received. Not revenue. `amount` excludes tip; `tip_amount` is gratuity.
 * Processing fees are cost, not a reduction of `sale.total_amount`.
 */
export const payments = pgTable(
  "payment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id").notNull(),
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(),
    tipAmount: integer("tip_amount").notNull().default(0),
    processingFeeAmount: integer("processing_fee_amount"),
    status: text("status").notNull(),
    method: text("method"),
    paidAt: timestamptz("paid_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("payment_sale_idx").on(table.saleId),
    index("payment_status_paid_idx").on(table.status, table.paidAt),
    foreignKey({
      columns: [table.saleId],
      foreignColumns: [sales.id],
      name: "payment_sale_id_fk",
    }).onDelete("restrict"),
    check("payment_currency_len", sql`char_length(${table.currency}) = 3`),
    check("payment_amount_nonneg", sql`${table.amount} >= 0`),
    check("payment_tip_amount_nonneg", sql`${table.tipAmount} >= 0`),
    check(
      "payment_processing_fee_amount_nonneg",
      sql`${table.processingFeeAmount} is null or ${table.processingFeeAmount} >= 0`,
    ),
  ],
);

/**
 * Reversal of payment/sale cash. Positive minor units; not a negative payment.
 */
export const refunds = pgTable(
  "refund",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id"),
    paymentId: uuid("payment_id"),
    currency: text("currency").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull(),
    refundedAt: timestamptz("refunded_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("refund_sale_idx").on(table.saleId),
    index("refund_payment_idx").on(table.paymentId),
    index("refund_status_refunded_idx").on(table.status, table.refundedAt),
    foreignKey({
      columns: [table.saleId],
      foreignColumns: [sales.id],
      name: "refund_sale_id_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "refund_payment_id_fk",
    }).onDelete("restrict"),
    check("refund_currency_len", sql`char_length(${table.currency}) = 3`),
    check("refund_amount_nonneg", sql`${table.amount} >= 0`),
    check(
      "refund_sale_or_payment",
      sql`${table.saleId} is not null or ${table.paymentId} is not null`,
    ),
  ],
);
