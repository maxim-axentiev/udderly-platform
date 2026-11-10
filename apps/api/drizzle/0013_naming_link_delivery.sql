ALTER TABLE "naming_reservation" ADD COLUMN "link_delivery_status" text;--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD COLUMN "link_delivery_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_link_delivery_status" CHECK ("link_delivery_status" is null or "link_delivery_status" in ('sending', 'sent', 'failed'));--> statement-breakpoint
ALTER TABLE "naming_reservation" ADD CONSTRAINT "naming_reservation_link_delivery_state" CHECK ((
	("link_delivery_status" is null and "link_delivery_started_at" is null)
	or (
		"status" = 'claimed'
		and "link_delivery_status" = 'sending'
		and "link_delivery_started_at" is not null
		and "naming_token_hash" is null
	)
	or (
		"status" = 'claimed'
		and "link_delivery_status" = 'failed'
		and "link_delivery_started_at" is not null
		and "naming_token_hash" is null
	)
	or (
		"status" = 'claimed'
		and "link_delivery_status" = 'sent'
		and "link_delivery_started_at" is not null
		and "naming_token_hash" is not null
	)
));
