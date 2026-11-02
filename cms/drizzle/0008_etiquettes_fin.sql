ALTER TABLE "tag" DROP CONSTRAINT "tag_kind_slug";--> statement-breakpoint
ALTER TABLE "event" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "tag" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_slug_unique" UNIQUE("slug");--> statement-breakpoint
DROP TYPE "public"."event_category";--> statement-breakpoint
DROP TYPE "public"."tag_kind";