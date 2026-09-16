ALTER TABLE "sale_line_item" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sale_line_item_sale_active_idx" ON "sale_line_item" USING btree ("sale_id","is_active");
