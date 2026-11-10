ALTER TABLE "naming_reservation" DROP CONSTRAINT "naming_reservation_state";--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_state" CHECK ((
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
		and "review_reason" in ('amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed', 'underpaid', 'purchase_after_deadline', 'payment_time_unverified')
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
		and "review_reason" in ('amount_mismatch', 'late_conflict', 'duplicate_booking', 'payment_reversed', 'underpaid', 'purchase_after_deadline', 'payment_time_unverified')
	)
));--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD COLUMN "link_resend_status" text;--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD COLUMN "link_resend_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD COLUMN "link_resend_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_link_resend_status" CHECK ("link_resend_status" is null or "link_resend_status" in ('sending', 'sent', 'failed'));--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_link_resend_count" CHECK ("link_resend_count" >= 0);--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_link_resend_state" CHECK ((
	(
		"link_resend_status" is null
		and "link_resend_started_at" is null
		and "link_resend_count" = 0
	)
	or (
		"status" = 'claimed'
		and "submitted_name" is not null
		and "named_at" is not null
		and "naming_token_hash" is not null
		and "link_resend_started_at" is not null
		and (
			("link_resend_status" = 'sent' and "link_resend_count" >= 1)
			or "link_resend_status" in ('sending', 'failed')
		)
	)
));--> statement-breakpoint
CREATE TABLE "naming_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naming_notice_kind" CHECK ("kind" in ('underpaid', 'purchase_after_deadline')),
	CONSTRAINT "naming_notice_status" CHECK ("status" in ('sending', 'sent', 'failed')),
	CONSTRAINT "naming_notice_attempt_count_nonneg" CHECK ("attempt_count" >= 0),
	CONSTRAINT "naming_notice_state" CHECK ((
		("status" in ('sending', 'failed') and "sent_at" is null)
		or ("status" = 'sent' and "sent_at" is not null)
	)),
	CONSTRAINT "naming_notice_provider" CHECK ("provider" is null or "provider" in ('resend', 'smtp'))
);--> statement-breakpoint
ALTER TABLE "naming_notice" ADD CONSTRAINT "naming_notice_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."naming_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "naming_notice_reservation_kind_uidx" ON "naming_notice" USING btree ("reservation_id","kind");--> statement-breakpoint
CREATE TABLE "naming_name_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"previous_name" text NOT NULL,
	"corrected_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naming_name_revision_previous_present" CHECK (char_length(btrim("previous_name")) > 0),
	CONSTRAINT "naming_name_revision_corrected_present" CHECK (char_length(btrim("corrected_name")) > 0)
);--> statement-breakpoint
ALTER TABLE "naming_name_revision" ADD CONSTRAINT "naming_name_revision_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."naming_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naming_name_revision" ADD CONSTRAINT "naming_name_revision_object_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."naming_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "naming_name_revision_reservation_idx" ON "naming_name_revision" USING btree ("reservation_id");
