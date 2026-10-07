CREATE TABLE "search_console_property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"permission_level" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_console_daily_total" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"gsc_date" date NOT NULL,
	"clicks" numeric(20, 9),
	"impressions" numeric(20, 9),
	"ctr" numeric(20, 9),
	"position" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_console_query" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"gsc_date" date NOT NULL,
	"query" text NOT NULL,
	"clicks" numeric(20, 9),
	"impressions" numeric(20, 9),
	"ctr" numeric(20, 9),
	"position" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_console_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"gsc_date" date NOT NULL,
	"page" text NOT NULL,
	"clicks" numeric(20, 9),
	"impressions" numeric(20, 9),
	"ctr" numeric(20, 9),
	"position" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_console_country" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"gsc_date" date NOT NULL,
	"country" text NOT NULL,
	"clicks" numeric(20, 9),
	"impressions" numeric(20, 9),
	"ctr" numeric(20, 9),
	"position" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_console_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"gsc_date" date NOT NULL,
	"device" text NOT NULL,
	"clicks" numeric(20, 9),
	"impressions" numeric(20, 9),
	"ctr" numeric(20, 9),
	"position" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "search_console_search_appearance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_url" text NOT NULL,
	"gsc_date" date NOT NULL,
	"search_appearance" text NOT NULL,
	"clicks" numeric(20, 9),
	"impressions" numeric(20, 9),
	"ctr" numeric(20, 9),
	"position" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "search_console_property" ADD CONSTRAINT "search_console_property_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_daily_total" ADD CONSTRAINT "search_console_daily_total_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_query" ADD CONSTRAINT "search_console_query_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_page" ADD CONSTRAINT "search_console_page_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_country" ADD CONSTRAINT "search_console_country_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_device" ADD CONSTRAINT "search_console_device_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_search_appearance" ADD CONSTRAINT "search_console_search_appearance_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_property_site_uidx" ON "search_console_property" USING btree ("site_url");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_daily_total_site_date_uidx" ON "search_console_daily_total" USING btree ("site_url","gsc_date");--> statement-breakpoint
CREATE INDEX "search_console_daily_total_date_idx" ON "search_console_daily_total" USING btree ("gsc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_query_grain_uidx" ON "search_console_query" USING btree ("site_url","gsc_date","query");--> statement-breakpoint
CREATE INDEX "search_console_query_date_idx" ON "search_console_query" USING btree ("gsc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_page_grain_uidx" ON "search_console_page" USING btree ("site_url","gsc_date","page");--> statement-breakpoint
CREATE INDEX "search_console_page_date_idx" ON "search_console_page" USING btree ("gsc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_country_grain_uidx" ON "search_console_country" USING btree ("site_url","gsc_date","country");--> statement-breakpoint
CREATE INDEX "search_console_country_date_idx" ON "search_console_country" USING btree ("gsc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_device_grain_uidx" ON "search_console_device" USING btree ("site_url","gsc_date","device");--> statement-breakpoint
CREATE INDEX "search_console_device_date_idx" ON "search_console_device" USING btree ("gsc_date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_search_appearance_grain_uidx" ON "search_console_search_appearance" USING btree ("site_url","gsc_date","search_appearance");--> statement-breakpoint
CREATE INDEX "search_console_search_appearance_date_idx" ON "search_console_search_appearance" USING btree ("gsc_date");
