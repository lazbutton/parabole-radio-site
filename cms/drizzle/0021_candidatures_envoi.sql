ALTER TABLE "audio_file" DROP CONSTRAINT "audio_file_show";--> statement-breakpoint
ALTER TABLE "application" ALTER COLUMN "ready" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "photo_id" uuid;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "tracklist" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "show_id" uuid;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "dossier_hash" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
-- Ajouté à la main : les candidatures déjà reçues (sans son) sont envoyées, avant la règle du dossier.
UPDATE "application" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "audio_file" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_show_id_show_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."show"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_file" ADD CONSTRAINT "audio_file_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_show" ON "application" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "audio_file_application" ON "audio_file" USING btree ("application_id");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_dossier_hash_unique" UNIQUE("dossier_hash");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_title" CHECK ("application"."title" is null or length("application"."title") between 1 and 200);--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_bio" CHECK ("application"."bio" is null or length("application"."bio") between 1 and 2000);--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_tracklist" CHECK ("application"."tracklist" is null or length("application"."tracklist") between 1 and 20000);--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_message" CHECK ("application"."message" is null or length("application"."message") between 1 and 2000);--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_dossier" CHECK (("application"."submitted_at" is null) = ("application"."dossier_hash" is not null));--> statement-breakpoint
ALTER TABLE "audio_file" ADD CONSTRAINT "audio_file_show" CHECK ("audio_file"."status" = 'uploading' or "audio_file"."show_id" is not null or "audio_file"."application_id" is not null);