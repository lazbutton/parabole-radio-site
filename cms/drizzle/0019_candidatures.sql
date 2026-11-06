CREATE TYPE "public"."application_status" AS ENUM('new', 'shortlisted', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "show_type" NOT NULL,
	"ready" boolean NOT NULL,
	"regular" boolean,
	"name" text NOT NULL,
	"city" text,
	"instagram" text,
	"email" text,
	"pitch" text NOT NULL,
	"listen_url" text,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"note" text,
	"artist_id" uuid,
	"answered_at" timestamp with time zone,
	"answered_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_contact" CHECK ("application"."instagram" is not null or "application"."email" is not null),
	CONSTRAINT "application_instagram" CHECK ("application"."instagram" is null or "application"."instagram" ~ '^[A-Za-z0-9._]{1,30}$'),
	CONSTRAINT "application_email" CHECK ("application"."email" is null or ("application"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' and length("application"."email") <= 200)),
	CONSTRAINT "application_listen_url" CHECK ("application"."listen_url" is null or ("application"."listen_url" ~ '^https?://' and length("application"."listen_url") <= 600)),
	CONSTRAINT "application_name" CHECK (length("application"."name") between 1 and 120),
	CONSTRAINT "application_city" CHECK ("application"."city" is null or length("application"."city") between 1 and 80),
	CONSTRAINT "application_pitch" CHECK (length("application"."pitch") between 1 and 2000),
	CONSTRAINT "application_answered" CHECK (("application"."status" in ('accepted', 'declined')) = ("application"."answered_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "application" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "application_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"open_types" "show_type"[] DEFAULT '{dj_set,podcast,playlist}' NOT NULL,
	"reply_days" integer DEFAULT 21 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_settings_single" CHECK ("application_settings"."id"),
	CONSTRAINT "application_settings_reply_days" CHECK ("application_settings"."reply_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "application_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "application_tag" (
	"application_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "application_tag_application_id_tag_id_pk" PRIMARY KEY("application_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "application_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_answered_by_member_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."member"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tag" ADD CONSTRAINT "application_tag_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_tag" ADD CONSTRAINT "application_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_status" ON "application" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "application_artist" ON "application" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "application_tag_tag" ON "application_tag" USING btree ("tag_id");