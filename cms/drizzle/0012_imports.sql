CREATE TYPE "public"."import_trigger" AS ENUM('cron', 'manual');--> statement-breakpoint
CREATE TABLE "radiocult_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "import_trigger" NOT NULL,
	"member_id" uuid,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"slots" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"error" text,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radiocult_import_counts" CHECK ("radiocult_import"."slots" >= 0 and "radiocult_import"."created" >= 0 and "radiocult_import"."updated" >= 0 and "radiocult_import"."unchanged" >= 0),
	CONSTRAINT "radiocult_import_report_object" CHECK (jsonb_typeof("radiocult_import"."report") = 'object')
);
--> statement-breakpoint
ALTER TABLE "radiocult_import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "radiocult_import" ADD CONSTRAINT "radiocult_import_member_id_member_user_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radiocult_import_created" ON "radiocult_import" USING btree ("created_at");