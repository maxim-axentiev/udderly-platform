CREATE TABLE "source_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshot_provider_entity_hash_uidx" ON "source_snapshot" USING btree ("provider","entity_type","external_id","payload_hash");--> statement-breakpoint
CREATE INDEX "source_snapshot_provider_entity_observed_idx" ON "source_snapshot" USING btree ("provider","entity_type","external_id","observed_at");
