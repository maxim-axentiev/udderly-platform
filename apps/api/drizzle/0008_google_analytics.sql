CREATE TABLE "analytics_property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"time_zone" text NOT NULL,
	"currency_code" text NOT NULL,
	"industry_category" text,
	"service_level" text,
	"property_type" text,
	"account_external_id" text,
	"provider_create_time" timestamp with time zone,
	"provider_update_time" timestamp with time zone,
	"event_data_retention" text,
	"user_data_retention" text,
	"reset_user_data_on_new_activity" text,
	"reporting_identity" text,
	"acquisition_lookback" text,
	"other_conversion_lookback" text,
	"reporting_attribution_model" text,
	"ads_web_conversion_export_scope" text,
	"stream_external_id" text,
	"stream_display_name" text,
	"stream_type" text,
	"measurement_id" text,
	"default_uri" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_property_currency_len" CHECK (char_length("analytics_property"."currency_code") = 3)
);--> statement-breakpoint
CREATE TABLE "analytics_key_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"event_name" text NOT NULL,
	"resource_name" text NOT NULL,
	"counting_method" text,
	"custom" text,
	"provider_create_time" timestamp with time zone,
	"default_currency_code" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_daily_total" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"sessions" numeric(20, 9),
	"active_users" numeric(20, 9),
	"total_users" numeric(20, 9),
	"new_users" numeric(20, 9),
	"engaged_sessions" numeric(20, 9),
	"engagement_rate" numeric(20, 9),
	"bounce_rate" numeric(20, 9),
	"average_session_duration" numeric(20, 9),
	"user_engagement_duration" numeric(20, 9),
	"event_count" numeric(20, 9),
	"screen_page_views" numeric(20, 9),
	"key_events" numeric(20, 9),
	"ecommerce_purchases" numeric(20, 9),
	"transactions" numeric(20, 9),
	"purchase_revenue" numeric(20, 9),
	"items_purchased" numeric(20, 9),
	"add_to_carts" numeric(20, 9),
	"currency_code" text,
	"site_totals_snapshot_id" uuid,
	"engagement_snapshot_id" uuid,
	"ecommerce_totals_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_session_acquisition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"session_source" text NOT NULL,
	"session_medium" text NOT NULL,
	"session_default_channel_group" text NOT NULL,
	"sessions" numeric(20, 9),
	"engaged_sessions" numeric(20, 9),
	"key_events" numeric(20, 9),
	"bounce_rate" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_first_user_acquisition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"first_user_source" text NOT NULL,
	"first_user_medium" text NOT NULL,
	"first_user_default_channel_group" text NOT NULL,
	"new_users" numeric(20, 9),
	"active_users" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_landing_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"landing_page" text NOT NULL,
	"sessions" numeric(20, 9),
	"engaged_sessions" numeric(20, 9),
	"key_events" numeric(20, 9),
	"active_users" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_page_path" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"page_path" text NOT NULL,
	"screen_page_views" numeric(20, 9),
	"event_count" numeric(20, 9),
	"active_users" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"event_name" text NOT NULL,
	"event_count" numeric(20, 9),
	"active_users" numeric(20, 9),
	"key_events" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_country" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"country" text NOT NULL,
	"sessions" numeric(20, 9),
	"active_users" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"device_category" text NOT NULL,
	"sessions" numeric(20, 9),
	"engaged_sessions" numeric(20, 9),
	"active_users" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "analytics_ecommerce_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_external_id" text NOT NULL,
	"farm_date" date NOT NULL,
	"item_id" text NOT NULL,
	"items_viewed" numeric(20, 9),
	"items_added_to_cart" numeric(20, 9),
	"items_purchased" numeric(20, 9),
	"item_revenue" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "analytics_property" ADD CONSTRAINT "analytics_property_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_key_event" ADD CONSTRAINT "analytics_key_event_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily_total" ADD CONSTRAINT "analytics_daily_total_site_snapshot_id_fk" FOREIGN KEY ("site_totals_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily_total" ADD CONSTRAINT "analytics_daily_total_engagement_snapshot_id_fk" FOREIGN KEY ("engagement_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily_total" ADD CONSTRAINT "analytics_daily_total_ecommerce_snapshot_id_fk" FOREIGN KEY ("ecommerce_totals_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_session_acquisition" ADD CONSTRAINT "analytics_session_acq_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_first_user_acquisition" ADD CONSTRAINT "analytics_first_user_acq_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_landing_page" ADD CONSTRAINT "analytics_landing_page_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_page_path" ADD CONSTRAINT "analytics_page_path_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_event" ADD CONSTRAINT "analytics_event_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_country" ADD CONSTRAINT "analytics_country_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_device" ADD CONSTRAINT "analytics_device_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_ecommerce_item" ADD CONSTRAINT "analytics_ecommerce_item_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_property_external_uidx" ON "analytics_property" USING btree ("property_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_key_event_property_name_uidx" ON "analytics_key_event" USING btree ("property_external_id","event_name");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_total_property_date_uidx" ON "analytics_daily_total" USING btree ("property_external_id","farm_date");--> statement-breakpoint
CREATE INDEX "analytics_daily_total_date_idx" ON "analytics_daily_total" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_session_acq_grain_uidx" ON "analytics_session_acquisition" USING btree ("property_external_id","farm_date","session_source","session_medium","session_default_channel_group");--> statement-breakpoint
CREATE INDEX "analytics_session_acq_date_idx" ON "analytics_session_acquisition" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_first_user_acq_grain_uidx" ON "analytics_first_user_acquisition" USING btree ("property_external_id","farm_date","first_user_source","first_user_medium","first_user_default_channel_group");--> statement-breakpoint
CREATE INDEX "analytics_first_user_acq_date_idx" ON "analytics_first_user_acquisition" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_landing_page_grain_uidx" ON "analytics_landing_page" USING btree ("property_external_id","farm_date","landing_page");--> statement-breakpoint
CREATE INDEX "analytics_landing_page_date_idx" ON "analytics_landing_page" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_page_path_grain_uidx" ON "analytics_page_path" USING btree ("property_external_id","farm_date","page_path");--> statement-breakpoint
CREATE INDEX "analytics_page_path_date_idx" ON "analytics_page_path" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_event_grain_uidx" ON "analytics_event" USING btree ("property_external_id","farm_date","event_name");--> statement-breakpoint
CREATE INDEX "analytics_event_date_idx" ON "analytics_event" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_country_grain_uidx" ON "analytics_country" USING btree ("property_external_id","farm_date","country");--> statement-breakpoint
CREATE INDEX "analytics_country_date_idx" ON "analytics_country" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_device_grain_uidx" ON "analytics_device" USING btree ("property_external_id","farm_date","device_category");--> statement-breakpoint
CREATE INDEX "analytics_device_date_idx" ON "analytics_device" USING btree ("farm_date");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_ecommerce_item_grain_uidx" ON "analytics_ecommerce_item" USING btree ("property_external_id","farm_date","item_id");--> statement-breakpoint
CREATE INDEX "analytics_ecommerce_item_date_idx" ON "analytics_ecommerce_item" USING btree ("farm_date");
