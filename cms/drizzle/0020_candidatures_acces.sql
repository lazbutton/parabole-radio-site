-- Les candidatures (0019_candidatures.sql, cms/README.md, 9.17) : leurs règles d'accès. La page /candidater écrit avec
-- la connexion du serveur, en propriétaire des tables, une fois la saisie vérifiée : le public n'a aucun droit. L'équipe
-- lit tout, met de côté, répond (un oui, ou pas cette fois), note, et efface une candidature indésirable. Les réglages
-- (les types ouverts, le délai de réponse annoncé) ne changent que par un admin.
-- Aucun point-virgule dans les textes : l'éditeur SQL de Supabase coupe les requêtes aux points-virgules.

-- 1. Les candidatures : l'équipe les lit, y répond et les efface. Personne ne les crée par l'API. -----------------
CREATE POLICY application_select ON public.application FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY application_update ON public.application FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY application_delete ON public.application FOR DELETE TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 2. Leurs styles : l'équipe les lit. Ils partent avec leur candidature. -----------------------------------------
CREATE POLICY application_tag_select ON public.application_tag FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 3. Les réglages : l'équipe les lit, un admin les change. Ni ajout ni suppression : la ligne est unique. ----------
CREATE POLICY application_settings_select ON public.application_settings FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY application_settings_update ON public.application_settings FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
--> statement-breakpoint

-- 4. Droits des rôles : rien pour le public, qui passe toujours par le serveur. ----------------------------------
REVOKE ALL ON public.application, public.application_tag, public.application_settings FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON public.application TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.application_tag TO authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.application_settings TO authenticated;
--> statement-breakpoint

-- 5. Dates de modification, et notes pour le tableau de bord de Supabase. ----------------------------------------
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.application FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.application_settings FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
COMMENT ON TABLE public.application IS 'Une candidature reçue par /candidater : son type, son contact, son idée, son lien d''écoute, et la réponse de l''équipe. Un refus est effacé six mois après.';
--> statement-breakpoint
COMMENT ON TABLE public.application_tag IS 'Les styles cochés par une candidature : des groupes des filtres de son type.';
--> statement-breakpoint
COMMENT ON TABLE public.application_settings IS 'Les réglages des candidatures, sur une ligne : les types ouverts, le délai de réponse annoncé en jours.';
--> statement-breakpoint

-- 6. La ligne des réglages : tout est ouvert, réponse annoncée sous 21 jours (trois semaines).
INSERT INTO public.application_settings (id) VALUES (true);
