CREATE TYPE "public"."audio_role" AS ENUM('main', 'part');--> statement-breakpoint
CREATE TYPE "public"."audio_status" AS ENUM('uploading', 'received', 'approved', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "audio_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid,
	"artist_id" uuid,
	"role" "audio_role" NOT NULL,
	"position" integer,
	"track_artist" text,
	"track_title" text,
	"duration_seconds" integer,
	"key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"status" "audio_status" DEFAULT 'uploading' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_file_key_unique" UNIQUE("key"),
	CONSTRAINT "audio_file_show" CHECK ("audio_file"."status" = 'uploading' or "audio_file"."show_id" is not null),
	CONSTRAINT "audio_file_part_status" CHECK ("audio_file"."role" = 'main' or "audio_file"."status" in ('uploading', 'received')),
	CONSTRAINT "audio_file_part_position" CHECK ("audio_file"."role" = 'main' or "audio_file"."status" = 'uploading' or "audio_file"."position" >= 1),
	CONSTRAINT "audio_file_key" CHECK ("audio_file"."key" ~ '^audio/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.(mp3|m4a|wav|aiff|flac)$'),
	CONSTRAINT "audio_file_size" CHECK ("audio_file"."size_bytes" is null or "audio_file"."size_bytes" > 0),
	CONSTRAINT "audio_file_duration" CHECK ("audio_file"."duration_seconds" is null or "audio_file"."duration_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "audio_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "broadcast_cycle" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"group1_start" date NOT NULL,
	"block_days" integer DEFAULT 14 NOT NULL,
	"deadline_days" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_cycle_single" CHECK ("broadcast_cycle"."id"),
	CONSTRAINT "broadcast_cycle_monday" CHECK (extract(isodow from "broadcast_cycle"."group1_start") = 1),
	CONSTRAINT "broadcast_cycle_days" CHECK ("broadcast_cycle"."block_days" in (7, 14, 21, 28) and "broadcast_cycle"."deadline_days" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "broadcast_cycle" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "submission" (
	"show_id" uuid PRIMARY KEY NOT NULL,
	"artist_id" uuid,
	"link" text,
	"note" text,
	"block_start" date,
	"week" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_link" CHECK ("submission"."link" is null or "submission"."link" ~ '^https://'),
	CONSTRAINT "submission_week" CHECK ("submission"."week" is null or "submission"."week" in (1, 2))
);
--> statement-breakpoint
ALTER TABLE "submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "upload_link" (
	"artist_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"profile_updated_at" timestamp with time zone,
	CONSTRAINT "upload_link_token_unique" UNIQUE("token"),
	CONSTRAINT "upload_link_token" CHECK ("upload_link"."token" ~ '^[A-Za-z0-9_-]{43}$')
);
--> statement-breakpoint
ALTER TABLE "upload_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist" ADD COLUMN "broadcast_group" smallint;--> statement-breakpoint
ALTER TABLE "audio_file" ADD CONSTRAINT "audio_file_show_id_show_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_file" ADD CONSTRAINT "audio_file_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_show_id_show_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_link" ADD CONSTRAINT "upload_link_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_link" ADD CONSTRAINT "upload_link_created_by_member_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_file_show" ON "audio_file" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "audio_file_status" ON "audio_file" USING btree ("status");--> statement-breakpoint
CREATE INDEX "submission_artist" ON "submission" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "submission_block" ON "submission" USING btree ("block_start");--> statement-breakpoint
ALTER TABLE "artist" ADD CONSTRAINT "artist_broadcast_group" CHECK ("artist"."broadcast_group" is null or "artist"."broadcast_group" in (1, 2));