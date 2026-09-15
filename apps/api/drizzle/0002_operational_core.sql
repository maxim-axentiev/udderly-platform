CREATE TABLE "booking_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"email_marketing_opt_in" boolean,
	"sms_opt_in" boolean,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_party_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"source_identity_id" uuid,
	"customer_type" text,
	"checkin_status" text,
	"sequence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"experience_id" uuid,
	"status" text NOT NULL,
	"party_size" integer,
	"source_type" text,
	"booked_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"rebooked_from_booking_id" uuid,
	"rebooked_to_booking_id" uuid,
	"is_superseded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experience_source_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_object_type" text NOT NULL,
	"external_id" text NOT NULL,
	"external_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"capacity" integer,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"internal_entity_type" text,
	"internal_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_identity_internal_pair" CHECK (("source_identity"."internal_entity_type" is null) = ("source_identity"."internal_entity_id" is null))
);
--> statement-breakpoint
CREATE TABLE "visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid,
	"session_id" uuid,
	"booking_id" uuid,
	"booking_party_member_id" uuid,
	"visited_at" timestamp with time zone,
	"status" text,
	"signed" boolean,
	"is_minor" boolean,
	"age_at_visit" integer,
	"age_band" text,
	"city" text,
	"postal" text,
	"referral_source" text,
	"group_type" text,
	"group_size" integer,
	"is_repeat_visitor" boolean,
	"marketing_opt_in" boolean,
	"match_confidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_contact" ADD CONSTRAINT "booking_contact_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_party_member" ADD CONSTRAINT "booking_party_member_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_party_member" ADD CONSTRAINT "booking_party_member_source_identity_id_fk" FOREIGN KEY ("source_identity_id") REFERENCES "public"."source_identity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_rebooked_from_fk" FOREIGN KEY ("rebooked_from_booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_rebooked_to_fk" FOREIGN KEY ("rebooked_to_booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_source_mapping" ADD CONSTRAINT "experience_source_mapping_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experience"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit" ADD CONSTRAINT "visit_booking_party_member_id_fk" FOREIGN KEY ("booking_party_member_id") REFERENCES "public"."booking_party_member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_contact_booking_uidx" ON "booking_contact" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_party_member_booking_idx" ON "booking_party_member" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_party_member_source_identity_idx" ON "booking_party_member" USING btree ("source_identity_id");--> statement-breakpoint
CREATE INDEX "booking_session_idx" ON "booking" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "booking_experience_idx" ON "booking" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "booking_status_booked_at_idx" ON "booking" USING btree ("status","booked_at");--> statement-breakpoint
CREATE INDEX "booking_booked_at_idx" ON "booking" USING btree ("booked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "experience_source_mapping_provider_object_uidx" ON "experience_source_mapping" USING btree ("provider","provider_object_type","external_id");--> statement-breakpoint
CREATE INDEX "experience_source_mapping_experience_idx" ON "experience_source_mapping" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "session_experience_start_idx" ON "session" USING btree ("experience_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_identity_provider_type_external_uidx" ON "source_identity" USING btree ("provider","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "source_identity_internal_idx" ON "source_identity" USING btree ("internal_entity_type","internal_entity_id");--> statement-breakpoint
CREATE INDEX "visit_session_visited_at_idx" ON "visit" USING btree ("session_id","visited_at");--> statement-breakpoint
CREATE INDEX "visit_booking_idx" ON "visit" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "visit_visited_at_idx" ON "visit" USING btree ("visited_at");--> statement-breakpoint
CREATE INDEX "visit_experience_idx" ON "visit" USING btree ("experience_id");
