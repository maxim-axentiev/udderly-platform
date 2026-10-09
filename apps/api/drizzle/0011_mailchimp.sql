CREATE TABLE "mailchimp_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_external_id" text NOT NULL,
	"name" text,
	"timezone_name" text NOT NULL,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mailchimp_audience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_external_id" text NOT NULL,
	"name" text,
	"member_count" integer,
	"unsubscribe_count" integer,
	"cleaned_count" integer,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mailchimp_audience_monthly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_external_id" text NOT NULL,
	"year_month" text NOT NULL,
	"subscribed" integer,
	"unsubscribed" integer,
	"cleaned" integer,
	"deleted" integer,
	"pending" integer,
	"reconfirm" integer,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mailchimp_audience_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_external_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"emails_sent" bigint,
	"unique_opens" bigint,
	"recipient_clicks" bigint,
	"hard_bounce" bigint,
	"soft_bounce" bigint,
	"subs" bigint,
	"unsubs" bigint,
	"other_adds" bigint,
	"other_removes" bigint,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mailchimp_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_external_id" text NOT NULL,
	"list_external_id" text,
	"type" text,
	"status" text,
	"title" text,
	"subject_line" text,
	"send_time" text,
	"ga_campaign_name" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mailchimp_campaign_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_external_id" text NOT NULL,
	"list_external_id" text,
	"emails_sent" integer,
	"abuse_reports" integer,
	"unsubscribed" integer,
	"hard_bounces" integer,
	"soft_bounces" integer,
	"opens_total" integer,
	"unique_opens" integer,
	"proxy_excluded_unique_opens" integer,
	"open_rate" numeric(20, 9),
	"clicks_total" integer,
	"unique_clicks" integer,
	"unique_subscriber_clicks" integer,
	"click_rate" numeric(20, 9),
	"send_time" text,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "mailchimp_campaign_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_external_id" text NOT NULL,
	"link_external_id" text NOT NULL,
	"url" text,
	"total_clicks" integer,
	"unique_clicks" integer,
	"source_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "mailchimp_account" ADD CONSTRAINT "mailchimp_account_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailchimp_audience" ADD CONSTRAINT "mailchimp_audience_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailchimp_audience_monthly" ADD CONSTRAINT "mailchimp_audience_monthly_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailchimp_audience_daily" ADD CONSTRAINT "mailchimp_audience_daily_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailchimp_campaign" ADD CONSTRAINT "mailchimp_campaign_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailchimp_campaign_report" ADD CONSTRAINT "mailchimp_campaign_report_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailchimp_campaign_link" ADD CONSTRAINT "mailchimp_campaign_link_source_snapshot_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_account_external_uidx" ON "mailchimp_account" USING btree ("account_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_audience_external_uidx" ON "mailchimp_audience" USING btree ("list_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_audience_monthly_grain_uidx" ON "mailchimp_audience_monthly" USING btree ("list_external_id","year_month");--> statement-breakpoint
CREATE INDEX "mailchimp_audience_monthly_month_idx" ON "mailchimp_audience_monthly" USING btree ("year_month");--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_audience_daily_grain_uidx" ON "mailchimp_audience_daily" USING btree ("list_external_id","metric_date");--> statement-breakpoint
CREATE INDEX "mailchimp_audience_daily_date_idx" ON "mailchimp_audience_daily" USING btree ("metric_date");--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_campaign_external_uidx" ON "mailchimp_campaign" USING btree ("campaign_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_campaign_report_external_uidx" ON "mailchimp_campaign_report" USING btree ("campaign_external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailchimp_campaign_link_grain_uidx" ON "mailchimp_campaign_link" USING btree ("campaign_external_id","link_external_id");
