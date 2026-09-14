CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"external_entity_type" text,
	"external_entity_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"duplicate_of" uuid,
	"safe_metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_duplicate_of_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."integration_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_events_provider_entity_idx" ON "integration_events" USING btree ("provider","external_entity_type","external_entity_id");--> statement-breakpoint
CREATE INDEX "integration_events_provider_hash_idx" ON "integration_events" USING btree ("provider","payload_hash");--> statement-breakpoint
CREATE INDEX "integration_events_processing_status_idx" ON "integration_events" USING btree ("processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_original_hash_idx" ON "integration_events" USING btree ("provider","payload_hash") WHERE "integration_events"."duplicate_of" is null;
