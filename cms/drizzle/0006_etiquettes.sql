CREATE TYPE "public"."facet_scope" AS ENUM('show', 'artist', 'event');--> statement-breakpoint
CREATE TABLE "artist_tag" (
	"artist_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "artist_tag_artist_id_tag_id_pk" PRIMARY KEY("artist_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "artist_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_tag" (
	"event_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "event_tag_event_id_tag_id_pk" PRIMARY KEY("event_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "event_tag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "facet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"scope" "facet_scope" NOT NULL,
	"show_types" "show_type"[] DEFAULT '{}' NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facet_slug_unique" UNIQUE("slug"),
	CONSTRAINT "facet_slug_format" CHECK ("facet"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "facet_position" CHECK ("facet"."position" >= 1),
	CONSTRAINT "facet_show_types" CHECK ("facet"."scope" = 'show' or cardinality("facet"."show_types") = 0)
);
--> statement-breakpoint
ALTER TABLE "facet" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tag_group" (
	"facet_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "tag_group_facet_id_tag_id_pk" PRIMARY KEY("facet_id","tag_id"),
	CONSTRAINT "tag_group_position" CHECK ("tag_group"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "tag_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tag_member" (
	"facet_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "tag_member_facet_id_group_id_tag_id_pk" PRIMARY KEY("facet_id","group_id","tag_id"),
	CONSTRAINT "tag_member_not_its_group" CHECK ("tag_member"."group_id" <> "tag_member"."tag_id")
);
--> statement-breakpoint
ALTER TABLE "tag_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "show" ADD COLUMN "energy" smallint;--> statement-breakpoint
ALTER TABLE "artist_tag" ADD CONSTRAINT "artist_tag_artist_id_artist_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_tag" ADD CONSTRAINT "artist_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tag" ADD CONSTRAINT "event_tag_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tag" ADD CONSTRAINT "event_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_group" ADD CONSTRAINT "tag_group_facet_id_facet_id_fk" FOREIGN KEY ("facet_id") REFERENCES "public"."facet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_group" ADD CONSTRAINT "tag_group_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_member" ADD CONSTRAINT "tag_member_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_member" ADD CONSTRAINT "tag_member_group_fk" FOREIGN KEY ("facet_id","group_id") REFERENCES "public"."tag_group"("facet_id","tag_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_tag_tag" ON "artist_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "event_tag_tag" ON "event_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_group_tag" ON "tag_group" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_member_tag" ON "tag_member" USING btree ("tag_id");--> statement-breakpoint
ALTER TABLE "show" ADD CONSTRAINT "show_energy" CHECK ("show"."energy" is null or "show"."energy" between 1 and 5);