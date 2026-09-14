CREATE TABLE "platform_meta" (
	"id" integer PRIMARY KEY NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL
);
