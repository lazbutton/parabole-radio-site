CREATE TABLE "site_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"crt_filter" boolean DEFAULT true NOT NULL,
	"crt_strength" smallint DEFAULT 100 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_settings_single" CHECK ("site_settings"."id"),
	CONSTRAINT "site_settings_crt_strength" CHECK ("site_settings"."crt_strength" between 10 and 200)
);
--> statement-breakpoint
ALTER TABLE "site_settings" ENABLE ROW LEVEL SECURITY;