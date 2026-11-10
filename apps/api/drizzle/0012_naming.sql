CREATE TABLE "naming_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"photo_url" text,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"published_at" timestamp with time zone,
	"status" text DEFAULT 'available' NOT NULL,
	"held_reservation_id" uuid,
	"claimed_reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naming_object_name_present" CHECK (char_length(btrim("name")) > 0),
	CONSTRAINT "naming_object_currency_cad" CHECK ("currency" = 'CAD'),
	CONSTRAINT "naming_object_price_amount_nonneg" CHECK ("price_amount" >= 0),
	CONSTRAINT "naming_object_status" CHECK ("status" in ('available', 'held', 'claimed')),
	CONSTRAINT "naming_object_hold_state" CHECK ((
		("status" = 'available' and "held_reservation_id" is null and "claimed_reservation_id" is null)
		or ("status" = 'held' and "held_reservation_id" is not null and "claimed_reservation_id" is null)
		or ("status" = 'claimed' and "claimed_reservation_id" is not null and "held_reservation_id" is null)
	))
);
--> statement-breakpoint
CREATE TABLE "naming_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"checkout_ref" text NOT NULL,
	"naming_token_hash" text,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"status" text NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"admin_resolution_required" boolean DEFAULT false NOT NULL,
	"released_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"fareharbor_booking_uuid" text,
	"paid_amount" integer,
	"review_reason" text,
	"submitted_name" text,
	"named_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naming_reservation_status" CHECK ("status" in ('held', 'released', 'claimed', 'needs_review')),
	CONSTRAINT "naming_reservation_currency_cad" CHECK ("currency" = 'CAD'),
	CONSTRAINT "naming_reservation_price_amount_nonneg" CHECK ("price_amount" >= 0),
	CONSTRAINT "naming_reservation_paid_amount_nonneg" CHECK ("paid_amount" is null or "paid_amount" >= 0),
	CONSTRAINT "naming_reservation_checkout_ref_present" CHECK (char_length(btrim("checkout_ref")) > 0),
	CONSTRAINT "naming_reservation_booking_uuid_present" CHECK ("fareharbor_booking_uuid" is null or char_length(btrim("fareharbor_booking_uuid")) > 0),
	CONSTRAINT "naming_reservation_token_hash_sha256" CHECK ("naming_token_hash" is null or "naming_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "naming_reservation_name_pair" CHECK ((
		("submitted_name" is null and "named_at" is null)
		or (
			"submitted_name" is not null
			and "named_at" is not null
			and char_length(btrim("submitted_name")) > 0
		)
	)),
	CONSTRAINT "naming_reservation_state" CHECK ((
		(
			"status" = 'held'
			and "released_at" is null
			and "claimed_at" is null
			and "fareharbor_booking_uuid" is null
			and "paid_amount" is null
			and "naming_token_hash" is null
			and "submitted_name" is null
			and "named_at" is null
			and "review_reason" is null
			and "hold_expires_at" is not null
			and "admin_resolution_required" = false
		)
		or (
			"status" = 'released'
			and "released_at" is not null
			and "claimed_at" is null
			and "fareharbor_booking_uuid" is null
			and "paid_amount" is null
			and "naming_token_hash" is null
			and "submitted_name" is null
			and "named_at" is null
			and "review_reason" is null
			and "admin_resolution_required" = false
		)
		or (
			"status" = 'claimed'
			and "claimed_at" is not null
			and "released_at" is null
			and "fareharbor_booking_uuid" is not null
			and "paid_amount" is not null
			and "admin_resolution_required" = false
			and (
				"review_reason" is null
				or "review_reason" in ('payment_reversed', 'duplicate_booking')
			)
		)
		or (
			"status" = 'needs_review'
			and "released_at" is null
			and "claimed_at" is null
			and "naming_token_hash" is null
			and "submitted_name" is null
			and "named_at" is null
			and "review_reason" in ('amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed')
			and (
				"admin_resolution_required" = true
				or "hold_expires_at" is not null
			)
		)
		or (
			"status" = 'needs_review'
			and "released_at" is not null
			and "claimed_at" is null
			and "naming_token_hash" is null
			and "submitted_name" is null
			and "named_at" is null
			and "review_reason" in ('amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed')
		)
	))
);
--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_id_object_uidx" UNIQUE("id","object_id");
--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_object_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."naming_object"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "naming_object" ADD CONSTRAINT "naming_object_held_reservation_fk" FOREIGN KEY ("held_reservation_id","id") REFERENCES "public"."naming_reservation"("id","object_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "naming_object" ADD CONSTRAINT "naming_object_claimed_reservation_fk" FOREIGN KEY ("claimed_reservation_id","id") REFERENCES "public"."naming_reservation"("id","object_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "naming_reservation_checkout_ref_uidx" ON "naming_reservation" USING btree ("checkout_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "naming_reservation_booking_uuid_uidx" ON "naming_reservation" USING btree ("fareharbor_booking_uuid");
--> statement-breakpoint
CREATE UNIQUE INDEX "naming_reservation_token_hash_uidx" ON "naming_reservation" USING btree ("naming_token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "naming_reservation_object_held_uidx" ON "naming_reservation" USING btree ("object_id") WHERE "naming_reservation"."status" = 'held' or ("naming_reservation"."status" = 'needs_review' and "naming_reservation"."released_at" is null);
--> statement-breakpoint
CREATE UNIQUE INDEX "naming_reservation_object_claimed_uidx" ON "naming_reservation" USING btree ("object_id") WHERE "naming_reservation"."status" = 'claimed';
--> statement-breakpoint
CREATE INDEX "naming_reservation_object_idx" ON "naming_reservation" USING btree ("object_id");
--> statement-breakpoint
CREATE INDEX "naming_reservation_held_expiry_idx" ON "naming_reservation" USING btree ("hold_expires_at") WHERE "naming_reservation"."status" = 'held' or ("naming_reservation"."status" = 'needs_review' and "naming_reservation"."released_at" is null and "naming_reservation"."admin_resolution_required" = false);
--> statement-breakpoint
CREATE INDEX "naming_object_status_idx" ON "naming_object" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "naming_object_published_at_idx" ON "naming_object" USING btree ("published_at");
