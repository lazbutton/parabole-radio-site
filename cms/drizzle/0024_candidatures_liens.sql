ALTER TABLE "application" ADD COLUMN "profile_url" text;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_profile_url" CHECK ("application"."profile_url" is null or ("application"."profile_url" ~ '^https?://' and length("application"."profile_url") <= 600));--> statement-breakpoint
-- Ajouté à la main : la règle de conservation, depuis les retours de l'équipe du 11 nov. 2026.
COMMENT ON TABLE public.application IS 'Une candidature reçue par /candidater : l''émission entière (son, titre, description, styles, tracklist), l''artiste (bio, photo, liens) et de quoi lui répondre. On ne répond qu''aux émissions retenues : « Pas cette fois » l''efface tout de suite ; une candidature validée est effacée six mois après.';--> statement-breakpoint
COMMENT ON COLUMN public.application_settings.reply_days IS 'Le délai de réponse annoncé, en jours : plus lu depuis le 11 nov. 2026 (la page ne promet plus de réponse qu''aux émissions retenues).';
