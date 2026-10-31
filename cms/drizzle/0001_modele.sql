CREATE TYPE "public"."artist_role" AS ENUM('resident', 'guest');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('art_ensemble', 'parabole', 'special', 'talk');--> statement-breakpoint
CREATE TYPE "public"."show_type" AS ENUM('dj_set', 'playlist', 'podcast');--> statement-breakpoint
CREATE TYPE "public"."tag_kind" AS ENUM('genre', 'mood', 'theme');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TABLE "artist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"role" "artist_role" DEFAULT 'guest' NOT NULL,
	"bio" text,
	"photo_id" uuid,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"radiocult_artist_id" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(name, '')), 'A') || setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(bio, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_slug_unique" UNIQUE("slug"),
	CONSTRAINT "artist_radiocult_artist_id_unique" UNIQUE("radiocult_artist_id"),
	CONSTRAINT "artist_slug_format" CHECK ("artist"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "artist_links_array" CHECK (jsonb_typeof("artist"."links") = 'array')
);
--> statement-breakpoint
ALTER TABLE "artist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"category" "event_category" NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue" text,
	"address" text,
	"description" text,
	"visual_id" uuid,
	"ticket_url" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(venue, '')), 'B') || setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(description, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_slug_unique" UNIQUE("slug"),
	CONSTRAINT "event_slug_format" CHECK ("event"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_dates" CHECK ("event"."ends_at" is null or "event"."ends_at" >= "event"."starts_at"),
	CONSTRAINT "event_ticket_url" CHECK ("event"."ticket_url" is null or "event"."ticket_url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_artist" (
	"event_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_artist_event_id_artist_id_pk" PRIMARY KEY("event_id","artist_id")
);
--> statement-breakpoint
ALTER TABLE "event_artist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_photo" (
	"event_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"caption" text,
	CONSTRAINT "event_photo_event_id_media_id_pk" PRIMARY KEY("event_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "event_photo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"alt" text DEFAULT '' NOT NULL,
	"credit" text,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_key_unique" UNIQUE("key"),
	CONSTRAINT "media_dimensions" CHECK (("media"."width" is null) = ("media"."height" is null) and coalesce("media"."width" > 0 and "media"."height" > 0, true)),
	CONSTRAINT "media_size" CHECK ("media"."size_bytes" is null or "media"."size_bytes" >= 0),
	CONSTRAINT "media_variants_array" CHECK (jsonb_typeof("media"."variants") = 'array')
);
--> statement-breakpoint
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "team_role" DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_email_unique" UNIQUE("email"),
	CONSTRAINT "member_email" CHECK ("member"."email" ~ '^[^@\s]+@[^@\s]+$')
);
--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_slug_unique" UNIQUE("slug"),
	CONSTRAINT "page_slug_format" CHECK ("page"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "show" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" "show_type" NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"broadcast_at" timestamp with time zone,
	"duration_seconds" integer,
	"description" text,
	"cover_id" uuid,
	"soundcloud_url" text,
	"soundcloud_track_id" text,
	"radiocult_event_id" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(description, '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "show_slug_unique" UNIQUE("slug"),
	CONSTRAINT "show_soundcloud_track_id_unique" UNIQUE("soundcloud_track_id"),
	CONSTRAINT "show_radiocult_event_id_unique" UNIQUE("radiocult_event_id"),
	CONSTRAINT "show_slug_format" CHECK ("show"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "show_published_has_date" CHECK ("show"."status" = 'draft' or "show"."broadcast_at" is not null),
	CONSTRAINT "show_duration" CHECK ("show"."duration_seconds" is null or "show"."duration_seconds" > 0),
	CONSTRAINT "show_soundcloud_url" CHECK ("show"."soundcloud_url" is null or "show"."soundcloud_url" ~ '^https://([a-z]+\.)?soundcloud\.com/'),
	CONSTRAINT "show_soundcloud_track_id" CHECK ("show"."soundcloud_track_id" is null or "show"."soundcloud_track_id" ~ '^[0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "show" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "show_artist" (
	"show_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "show_artist_show_id_artist_id_pk" PRIMARY KEY("show_id","artist_id")
);
--> statement-breakpoint
ALTER TABLE "show_artist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "show_tag" (
	"show_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "show_tag_show_id_tag_id_pk" PRIMARY KEY("show_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "show_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "tag_kind" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(name, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_kind_slug" UNIQUE("kind","slug"),
	CONSTRAINT "tag_slug_format" CHECK ("tag"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "track" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"artist" text NOT NULL,
	"title" text NOT NULL,
	"start_seconds" integer,
	"hopper_url" text,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(artist, '')), 'D') || setweight(to_tsvector('public.french_unaccent'::regconfig, coalesce(title, '')), 'D')) STORED,
	CONSTRAINT "track_show_position" UNIQUE("show_id","position"),
	CONSTRAINT "track_position" CHECK ("track"."position" >= 1),
	CONSTRAINT "track_start" CHECK ("track"."start_seconds" is null or "track"."start_seconds" >= 0),
	CONSTRAINT "track_hopper_url" CHECK ("track"."hopper_url" is null or "track"."hopper_url" ~ '^https://hppr\.fr/')
);
--> statement-breakpoint
ALTER TABLE "track" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist" ADD CONSTRAINT "artist_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_visual_id_media_id_fk" FOREIGN KEY ("visual_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artist" ADD CONSTRAINT "event_artist_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artist" ADD CONSTRAINT "event_artist_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_photo" ADD CONSTRAINT "event_photo_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_photo" ADD CONSTRAINT "event_photo_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show" ADD CONSTRAINT "show_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_artist" ADD CONSTRAINT "show_artist_show_id_show_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_artist" ADD CONSTRAINT "show_artist_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_tag" ADD CONSTRAINT "show_tag_show_id_show_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "show_tag" ADD CONSTRAINT "show_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track" ADD CONSTRAINT "track_show_id_show_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."show"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_role_status" ON "artist" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "artist_photo" ON "artist" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "artist_search" ON "artist" USING gin ("search");--> statement-breakpoint
CREATE INDEX "event_status_starts" ON "event" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "event_visual" ON "event" USING btree ("visual_id");--> statement-breakpoint
CREATE INDEX "event_search" ON "event" USING gin ("search");--> statement-breakpoint
CREATE INDEX "event_artist_artist" ON "event_artist" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "event_photo_media" ON "event_photo" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "show_status_broadcast" ON "show" USING btree ("status","broadcast_at");--> statement-breakpoint
CREATE INDEX "show_cover" ON "show" USING btree ("cover_id");--> statement-breakpoint
CREATE INDEX "show_search" ON "show" USING gin ("search");--> statement-breakpoint
CREATE INDEX "show_artist_artist" ON "show_artist" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "show_tag_tag" ON "show_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_search" ON "tag" USING gin ("search");--> statement-breakpoint
CREATE INDEX "track_search" ON "track" USING gin ("search");