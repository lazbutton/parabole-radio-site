CREATE TABLE "background_clip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"video_url" text NOT NULL,
	"poster_url" text,
	"mime_type" text DEFAULT 'video/mp4' NOT NULL,
	"size_bytes" bigint,
	"duration_seconds" integer,
	"width" integer,
	"height" integer,
	"position" integer NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_clip_video_url_unique" UNIQUE("video_url"),
	CONSTRAINT "background_clip_video_url" CHECK ("background_clip"."video_url" ~ '^(/[^/]|https://)'),
	CONSTRAINT "background_clip_poster_url" CHECK ("background_clip"."poster_url" is null or "background_clip"."poster_url" ~ '^(/[^/]|https://)'),
	CONSTRAINT "background_clip_position" CHECK ("background_clip"."position" >= 1),
	CONSTRAINT "background_clip_dimensions" CHECK (("background_clip"."width" is null) = ("background_clip"."height" is null) and coalesce("background_clip"."width" > 0 and "background_clip"."height" > 0, true)),
	CONSTRAINT "background_clip_size" CHECK ("background_clip"."size_bytes" is null or "background_clip"."size_bytes" >= 0),
	CONSTRAINT "background_clip_duration" CHECK ("background_clip"."duration_seconds" is null or "background_clip"."duration_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "background_clip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "background_clip_status_position" ON "background_clip" USING btree ("status","position");