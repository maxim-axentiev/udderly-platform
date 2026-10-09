CREATE TABLE "meta_ads_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"name" text,
	"currency" text NOT NULL,
	"timezone_name" text NOT NULL,
	"account_status" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"campaign_external_id" text NOT NULL,
	"name" text,
	"status" text,
	"effective_status" text,
	"objective" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_ad_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"ad_set_external_id" text NOT NULL,
	"campaign_external_id" text,
	"name" text,
	"status" text,
	"effective_status" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_ad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"ad_external_id" text NOT NULL,
	"ad_set_external_id" text,
	"campaign_external_id" text,
	"name" text,
	"status" text,
	"effective_status" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_account_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"attribution_window" text NOT NULL,
	"spend_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"impressions" bigint,
	"clicks" bigint,
	"reach" bigint,
	"frequency" numeric(20, 9),
	"cpc" numeric(20, 9),
	"cpm" numeric(20, 9),
	"ctr" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_campaign_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"campaign_external_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"attribution_window" text NOT NULL,
	"spend_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"impressions" bigint,
	"clicks" bigint,
	"reach" bigint,
	"frequency" numeric(20, 9),
	"cpc" numeric(20, 9),
	"cpm" numeric(20, 9),
	"ctr" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_ad_set_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"ad_set_external_id" text NOT NULL,
	"campaign_external_id" text,
	"metric_date" date NOT NULL,
	"attribution_window" text NOT NULL,
	"spend_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"impressions" bigint,
	"clicks" bigint,
	"reach" bigint,
	"frequency" numeric(20, 9),
	"cpc" numeric(20, 9),
	"cpm" numeric(20, 9),
	"ctr" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meta_ads_ad_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"ad_external_id" text NOT NULL,
	"ad_set_external_id" text,
	"campaign_external_id" text,
	"metric_date" date NOT NULL,
	"attribution_window" text NOT NULL,
	"spend_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"impressions" bigint,
	"clicks" bigint,
	"reach" bigint,
	"frequency" numeric(20, 9),
	"cpc" numeric(20, 9),
	"cpm" numeric(20, 9),
	"ctr" numeric(20, 9),
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "meta_ads_account" ADD CONSTRAINT "meta_ads_account_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_campaign" ADD CONSTRAINT "meta_ads_campaign_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_ad_set" ADD CONSTRAINT "meta_ads_ad_set_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_ad" ADD CONSTRAINT "meta_ads_ad_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_account_daily" ADD CONSTRAINT "meta_ads_account_daily_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_campaign_daily" ADD CONSTRAINT "meta_ads_campaign_daily_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_ad_set_daily" ADD CONSTRAINT "meta_ads_ad_set_daily_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads_ad_daily" ADD CONSTRAINT "meta_ads_ad_daily_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_account_external_uidx" ON "meta_ads_account" USING btree ("account_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_campaign_external_uidx" ON "meta_ads_campaign" USING btree ("account_external_id","campaign_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_ad_set_external_uidx" ON "meta_ads_ad_set" USING btree ("account_external_id","ad_set_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_ad_external_uidx" ON "meta_ads_ad" USING btree ("account_external_id","ad_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_account_daily_grain_uidx" ON "meta_ads_account_daily" USING btree ("account_external_id","metric_date","attribution_window");--> statement-breakpoint
CREATE INDEX "meta_ads_account_daily_date_idx" ON "meta_ads_account_daily" USING btree ("metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_campaign_daily_grain_uidx" ON "meta_ads_campaign_daily" USING btree ("account_external_id","campaign_external_id","metric_date","attribution_window");--> statement-breakpoint
CREATE INDEX "meta_ads_campaign_daily_date_idx" ON "meta_ads_campaign_daily" USING btree ("metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_ad_set_daily_grain_uidx" ON "meta_ads_ad_set_daily" USING btree ("account_external_id","ad_set_external_id","metric_date","attribution_window");--> statement-breakpoint
CREATE INDEX "meta_ads_ad_set_daily_date_idx" ON "meta_ads_ad_set_daily" USING btree ("metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_ad_daily_grain_uidx" ON "meta_ads_ad_daily" USING btree ("account_external_id","ad_external_id","metric_date","attribution_window");--> statement-breakpoint
CREATE INDEX "meta_ads_ad_daily_date_idx" ON "meta_ads_ad_daily" USING btree ("metric_date");
