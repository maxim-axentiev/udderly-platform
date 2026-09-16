CREATE TABLE "product_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_category_assignment" (
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_category_assignment_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_variation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text,
	"sku" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"booking_id" uuid,
	"experience_id" uuid,
	"session_id" uuid,
	"source_type" text,
	"subtotal_amount" integer DEFAULT 0 NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"service_charge_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_currency_len" CHECK (char_length("currency") = 3),
	CONSTRAINT "sale_subtotal_amount_nonneg" CHECK ("subtotal_amount" >= 0),
	CONSTRAINT "sale_discount_amount_nonneg" CHECK ("discount_amount" >= 0),
	CONSTRAINT "sale_tax_amount_nonneg" CHECK ("tax_amount" >= 0),
	CONSTRAINT "sale_service_charge_amount_nonneg" CHECK ("service_charge_amount" >= 0),
	CONSTRAINT "sale_total_amount_nonneg" CHECK ("total_amount" >= 0),
	CONSTRAINT "sale_experience_has_booking" CHECK ("kind" <> 'experience' or "booking_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "sale_line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid,
	"product_variation_id" uuid,
	"experience_id" uuid,
	"description" text,
	"quantity" numeric(12, 4) NOT NULL,
	"currency" text NOT NULL,
	"gross_amount" integer DEFAULT 0 NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_line_item_currency_len" CHECK (char_length("currency") = 3),
	CONSTRAINT "sale_line_item_gross_amount_nonneg" CHECK ("gross_amount" >= 0),
	CONSTRAINT "sale_line_item_discount_amount_nonneg" CHECK ("discount_amount" >= 0),
	CONSTRAINT "sale_line_item_tax_amount_nonneg" CHECK ("tax_amount" >= 0),
	CONSTRAINT "sale_line_item_total_amount_nonneg" CHECK ("total_amount" >= 0),
	CONSTRAINT "sale_line_item_quantity_nonneg" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"tip_amount" integer DEFAULT 0 NOT NULL,
	"processing_fee_amount" integer,
	"status" text NOT NULL,
	"method" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_currency_len" CHECK (char_length("currency") = 3),
	CONSTRAINT "payment_amount_nonneg" CHECK ("amount" >= 0),
	CONSTRAINT "payment_tip_amount_nonneg" CHECK ("tip_amount" >= 0),
	CONSTRAINT "payment_processing_fee_amount_nonneg" CHECK ("processing_fee_amount" is null or "processing_fee_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid,
	"payment_id" uuid,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_currency_len" CHECK (char_length("currency") = 3),
	CONSTRAINT "refund_amount_nonneg" CHECK ("amount" >= 0),
	CONSTRAINT "refund_sale_or_payment" CHECK ("sale_id" is not null or "payment_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "product_category_assignment" ADD CONSTRAINT "product_category_assignment_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_category_assignment" ADD CONSTRAINT "product_category_assignment_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_category"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_variation" ADD CONSTRAINT "product_variation_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_product_variation_id_fk" FOREIGN KEY ("product_variation_id") REFERENCES "public"."product_variation"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_category_status_idx" ON "product_category" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "product_status_idx" ON "product" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "product_category_assignment_category_idx" ON "product_category_assignment" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "product_variation_product_idx" ON "product_variation" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "product_variation_sku_idx" ON "product_variation" USING btree ("sku");
--> statement-breakpoint
CREATE INDEX "product_variation_status_idx" ON "product_variation" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_booking_uidx" ON "sale" USING btree ("booking_id");
--> statement-breakpoint
CREATE INDEX "sale_status_occurred_idx" ON "sale" USING btree ("status","occurred_at");
--> statement-breakpoint
CREATE INDEX "sale_experience_occurred_idx" ON "sale" USING btree ("experience_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "sale_kind_occurred_idx" ON "sale" USING btree ("kind","occurred_at");
--> statement-breakpoint
CREATE INDEX "sale_line_item_sale_idx" ON "sale_line_item" USING btree ("sale_id");
--> statement-breakpoint
CREATE INDEX "sale_line_item_product_idx" ON "sale_line_item" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "sale_line_item_product_variation_idx" ON "sale_line_item" USING btree ("product_variation_id");
--> statement-breakpoint
CREATE INDEX "payment_sale_idx" ON "payment" USING btree ("sale_id");
--> statement-breakpoint
CREATE INDEX "payment_status_paid_idx" ON "payment" USING btree ("status","paid_at");
--> statement-breakpoint
CREATE INDEX "refund_sale_idx" ON "refund" USING btree ("sale_id");
--> statement-breakpoint
CREATE INDEX "refund_payment_idx" ON "refund" USING btree ("payment_id");
--> statement-breakpoint
CREATE INDEX "refund_status_refunded_idx" ON "refund" USING btree ("status","refunded_at");
