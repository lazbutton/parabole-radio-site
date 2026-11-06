-- Les réglages du site (0021_reglages_du_site.sql) : leurs règles d'accès, sur le modèle de 0005_fond_acces.sql. Le
-- public les lit (le fond du site, par /api/fond) ; l'équipe, admin et éditeur, les change depuis l'écran Vidéos de
-- fond, comme les vidéos elles-mêmes.
-- Aucun point-virgule dans les textes : l'éditeur SQL de Supabase coupe les requêtes aux points-virgules.

-- 1. Lire : tout le monde. Changer : l'équipe. Ni ajout ni suppression : la ligne est unique. ---------------------
CREATE POLICY site_settings_select ON public.site_settings FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY site_settings_update ON public.site_settings FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 2. Droits des rôles. ---------------------------------------------------------------------------------------------
REVOKE ALL ON public.site_settings FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.site_settings TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.site_settings TO authenticated;
--> statement-breakpoint

-- 3. Date de modification, et note pour le tableau de bord de Supabase. -------------------------------------------
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
COMMENT ON TABLE public.site_settings IS 'Les réglages du site public, sur une ligne : le filtre cathodique posé sur tout le site, allumé ou non, et sa force en pour cent (100 : l''effet d''origine).';
--> statement-breakpoint

-- 4. La ligne des réglages : le filtre allumé, à sa force d'origine (le site tel qu'il était).
INSERT INTO public.site_settings (id) VALUES (true);
