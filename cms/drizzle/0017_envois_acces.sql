-- Les envois des résidents (0016_envois.sql, cms/README.md, 9.12) : leurs règles d'accès. La page d'envoi d'un
-- résident écrit avec la connexion du serveur, en propriétaire des tables, une fois son jeton vérifié : le public n'a
-- aucun droit. L'équipe lit tout et range sous son rôle : rattacher un envoi à son créneau, valider un son, inscrire
-- une playlist assemblée, effacer un fichier. Le calendrier des groupes ne change que par un admin.
-- Aucun point-virgule dans les textes : l'éditeur SQL de Supabase coupe les requêtes aux points-virgules.

-- 1. Les liens d'envoi : l'équipe les lit, les crée, les renouvelle et les efface. ---------------------------------
CREATE POLICY upload_link_select ON public.upload_link FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY upload_link_insert ON public.upload_link FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY upload_link_update ON public.upload_link FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY upload_link_delete ON public.upload_link FOR DELETE TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 2. Les envois et leurs fichiers son : l'équipe, admin et éditeur. -----------------------------------------------
CREATE POLICY submission_select ON public.submission FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY submission_insert ON public.submission FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY submission_update ON public.submission FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY submission_delete ON public.submission FOR DELETE TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY audio_file_select ON public.audio_file FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY audio_file_insert ON public.audio_file FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY audio_file_update ON public.audio_file FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY audio_file_delete ON public.audio_file FOR DELETE TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 3. Le calendrier des groupes : l'équipe le lit, un admin le règle. Ni ajout ni suppression : la ligne est unique. ---
CREATE POLICY broadcast_cycle_select ON public.broadcast_cycle FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY broadcast_cycle_update ON public.broadcast_cycle FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
--> statement-breakpoint

-- 4. Droits des rôles : rien pour le public, qui passe toujours par le serveur. ----------------------------------
REVOKE ALL ON public.upload_link, public.submission, public.audio_file, public.broadcast_cycle FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_link, public.submission, public.audio_file TO authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.broadcast_cycle TO authenticated;
--> statement-breakpoint

-- 5. Un seul son actif par show : un nouvel envoi n'efface l'ancien qu'une fois arrivé en entier. -----------------
CREATE UNIQUE INDEX audio_file_one_main ON public.audio_file (show_id) WHERE role = 'main' AND status <> 'uploading';
--> statement-breakpoint

-- 6. Dates de modification, et notes pour le tableau de bord de Supabase. ----------------------------------------
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.submission FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.audio_file FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.broadcast_cycle FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
COMMENT ON TABLE public.upload_link IS 'Le lien d''envoi d''un artiste (/envoyer/<jeton>), sans compte : il y envoie ses émissions et met à jour sa bio et sa photo.';
--> statement-breakpoint
COMMENT ON TABLE public.submission IS 'Un envoi : le show qu''un artiste remplit par son lien, son mot pour l''équipe, le lien de sa playlist, le bloc visé.';
--> statement-breakpoint
COMMENT ON TABLE public.audio_file IS 'Les fichiers son dans le seau Cloudflare R2 : le son d''un show, ou les morceaux d''une playlist à assembler.';
--> statement-breakpoint
COMMENT ON TABLE public.broadcast_cycle IS 'Le calendrier des deux groupes de résidents : premier lundi du groupe 1, durée d''un bloc, deadline en jours avant le bloc.';
--> statement-breakpoint

-- 7. La ligne du calendrier, d'après l'agenda de l'équipe : le groupe 1 commence un bloc le lundi 14 décembre 2026,
-- le groupe 2 le 28, deux semaines chacun, deadline le dimanche 15 jours avant.
INSERT INTO public.broadcast_cycle (group1_start, block_days, deadline_days) VALUES ('2026-12-14', 14, 15);
