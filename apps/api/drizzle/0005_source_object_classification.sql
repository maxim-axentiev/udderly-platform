CREATE TABLE "source_object_classification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"classification" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_object_classification_uidx" ON "source_object_classification" USING btree ("provider","provider_object_type","external_id");--> statement-breakpoint
CREATE INDEX "source_object_classification_class_idx" ON "source_object_classification" USING btree ("classification");
