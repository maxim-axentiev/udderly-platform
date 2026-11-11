ALTER TABLE "naming_object" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "naming_object"
SET "is_test" = true
WHERE lower(btrim("name")) = 'test naming bucket';
