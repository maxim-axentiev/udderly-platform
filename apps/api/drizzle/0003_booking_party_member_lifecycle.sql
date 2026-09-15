ALTER TABLE "booking_party_member" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_party_member" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_party_member" ADD COLUMN "removed_at" timestamp with time zone;
