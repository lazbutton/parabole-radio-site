-- Règles d'accès, écrites à la main : qui lit et qui écrit quoi.
--
-- Postgres voit chaque visiteur sous un rôle de Supabase :
--   - le public : le rôle anon, et authenticated pour un compte sans fiche dans « member ». Il lit ce qui est
--     publié et n'écrit rien. Les auditeurs n'ont jamais de compte : ils restent anon ;
--   - l'éditeur (authenticated, member.role = 'editor') : lit et écrit tous les contenus, brouillons compris ;
--   - l'admin (member.role = 'admin') : comme l'éditeur, et gère les membres de l'équipe.
-- La sécurité par ligne (RLS) applique ces règles à toutes les requêtes de ces rôles : par l'API de Supabase comme
-- par le site, qui lit sous le rôle anon (src/access.ts). Le propriétaire des tables (postgres), qui lance les
-- migrations et le seed, n'y est pas soumis.
--
-- Une table de plus : ses règles et ses droits dans une nouvelle migration écrite à la main
-- (npm run db:custom -- --name=…), sur le modèle de celle-ci. Sans règle, la table reste fermée à tous.

-- 1. Qui est dans l'équipe ? --------------------------------------------------------------------------------------

-- team_role() lit « member » avec les droits de son propriétaire (SECURITY DEFINER) : une règle de « member » qui
-- relirait « member » sous sa propre règle tournerait en rond. Elle ne dit que le rôle de la personne connectée.
CREATE FUNCTION private.team_role() RETURNS public.team_role
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT role FROM public.member WHERE user_id = (SELECT auth.uid()) $$;
--> statement-breakpoint
CREATE FUNCTION private.is_team_member() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = ''
  AS $$ SELECT private.team_role() IS NOT NULL $$;
--> statement-breakpoint
CREATE FUNCTION private.is_admin() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = ''
  AS $$ SELECT coalesce(private.team_role() = 'admin', false) $$;
--> statement-breakpoint

-- Un fichier est public quand un contenu publié s'en sert : pochette d'un show, photo d'un artiste, visuel ou galerie
-- d'un événement. Les autres (ceux d'un brouillon, ceux pas encore placés) restent à l'équipe. La fonction lit les
-- tables avec les droits de la personne connectée : pour le public, seuls les contenus publiés existent.
CREATE FUNCTION private.media_is_public(file_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = ''
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.show WHERE cover_id = file_id AND status = 'published')
        OR EXISTS (SELECT 1 FROM public.artist WHERE photo_id = file_id AND status = 'published')
        OR EXISTS (SELECT 1 FROM public.event WHERE visual_id = file_id AND status = 'published')
        OR EXISTS (SELECT 1 FROM public.event_photo p JOIN public.event e ON e.id = p.event_id
                   WHERE p.media_id = file_id AND e.status = 'published')
  $$;
--> statement-breakpoint

-- 2. Lire ---------------------------------------------------------------------------------------------------------
-- (SELECT private.is_team_member()) entre parenthèses : Postgres le calcule une fois par requête, pas par ligne.

-- Les contenus : le public voit le publié, l'équipe voit tout.
CREATE POLICY show_select ON public.show FOR SELECT TO anon, authenticated
  USING (status = 'published' OR (SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY artist_select ON public.artist FOR SELECT TO anon, authenticated
  USING (status = 'published' OR (SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY event_select ON public.event FOR SELECT TO anon, authenticated
  USING (status = 'published' OR (SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY page_select ON public.page FOR SELECT TO anon, authenticated
  USING (status = 'published' OR (SELECT private.is_team_member()));
--> statement-breakpoint

-- Les étiquettes sont publiques ; les fichiers, quand un contenu publié s'en sert.
CREATE POLICY tag_select ON public.tag FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY media_select ON public.media FOR SELECT TO anon, authenticated
  USING ((SELECT private.is_team_member()) OR private.media_is_public(id));
--> statement-breakpoint

-- La tracklist, les artistes et les étiquettes d'un show, les artistes et la galerie d'un événement suivent leur
-- contenu : visibles quand il l'est. La sous-requête passe elle-même par la règle de la table lue.
CREATE POLICY track_select ON public.track FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.show s WHERE s.id = show_id));
--> statement-breakpoint
CREATE POLICY show_artist_select ON public.show_artist FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.show s WHERE s.id = show_id) AND EXISTS (SELECT 1 FROM public.artist a WHERE a.id = artist_id));
--> statement-breakpoint
CREATE POLICY show_tag_select ON public.show_tag FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.show s WHERE s.id = show_id));
--> statement-breakpoint
CREATE POLICY event_artist_select ON public.event_artist FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.event e WHERE e.id = event_id) AND EXISTS (SELECT 1 FROM public.artist a WHERE a.id = artist_id));
--> statement-breakpoint
CREATE POLICY event_photo_select ON public.event_photo FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.event e WHERE e.id = event_id));
--> statement-breakpoint

-- L'équipe se voit entre elle ; le public ne voit personne.
CREATE POLICY member_select ON public.member FOR SELECT TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 3. Écrire -------------------------------------------------------------------------------------------------------

-- Les contenus et les fichiers : l'équipe, admin et éditeur. Une règle par opération et par table.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media', 'tag', 'artist', 'show', 'show_artist', 'show_tag', 'track', 'event', 'event_artist', 'event_photo', 'page'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_team_member()))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT private.is_team_member()))', t || '_delete', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Les membres : l'admin seulement. L'éditeur ne gère pas l'équipe.
CREATE POLICY member_insert ON public.member FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));
--> statement-breakpoint
CREATE POLICY member_update ON public.member FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
--> statement-breakpoint
CREATE POLICY member_delete ON public.member FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));
--> statement-breakpoint

-- L'équipe garde toujours un admin : sans lui, plus personne ne pourrait gérer les membres. Vérifié à la fin de la
-- transaction, pour qu'un admin puisse en nommer un autre avant de céder sa place.
CREATE FUNCTION private.keep_an_admin() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.member WHERE role = 'admin') THEN
      RAISE EXCEPTION 'L''équipe doit garder au moins un admin.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER keep_an_admin AFTER UPDATE OF role OR DELETE ON public.member
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.keep_an_admin();
--> statement-breakpoint

-- 4. Droits des rôles ---------------------------------------------------------------------------------------------
-- Supabase donne d'office tous les droits aux rôles de l'API sur les tables du schéma public : la RLS serait la
-- seule barrière. On retire ce qui ne sert jamais : le public ne fait que lire (et ne lit pas l'équipe) ; personne
-- ne vide une table par l'API (TRUNCATE échappe à la RLS).
REVOKE ALL ON public.media, public.tag, public.artist, public.show, public.show_artist, public.show_tag, public.track,
  public.event, public.event_artist, public.event_photo, public.page, public.member FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.media, public.tag, public.artist, public.show, public.show_artist, public.show_tag, public.track,
  public.event, public.event_artist, public.event_photo, public.page TO anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media, public.tag, public.artist, public.show, public.show_artist,
  public.show_tag, public.track, public.event, public.event_artist, public.event_photo, public.page, public.member TO authenticated;
--> statement-breakpoint
-- Les règles et les requêtes du site appellent les fonctions de « private ».
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
--> statement-breakpoint

-- 5. Date de modification -----------------------------------------------------------------------------------------
-- updated_at suit chaque modification, d'où qu'elle vienne : écrans d'admin, API, éditeur SQL de Supabase.
CREATE FUNCTION private.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = ''
  AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media', 'tag', 'artist', 'show', 'event', 'page', 'member'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 6. Notes pour le tableau de bord de Supabase --------------------------------------------------------------------
COMMENT ON TABLE public.show IS 'Un épisode archivé ou à venir : DJ set, playlist ou podcast. Le son est sur SoundCloud.';
--> statement-breakpoint
COMMENT ON TABLE public.track IS 'La tracklist d''un show, dans l''ordre (position 1, 2, 3…).';
--> statement-breakpoint
COMMENT ON TABLE public.artist IS 'Un résident ou un invité.';
--> statement-breakpoint
COMMENT ON TABLE public.event IS 'Un événement : Art ensemble, Parabole, Special ou Talk.';
--> statement-breakpoint
COMMENT ON TABLE public.tag IS 'Une étiquette de show : genre, mood ou thème.';
--> statement-breakpoint
COMMENT ON TABLE public.page IS 'Une page de texte simple (À propos…), en Markdown.';
--> statement-breakpoint
COMMENT ON TABLE public.media IS 'Un fichier envoyé sur Cloudflare R2 (clé dans le seau, type, dimensions, texte alternatif).';
--> statement-breakpoint
COMMENT ON TABLE public.member IS 'L''équipe : un compte Supabase Auth et son rôle (admin ou editor). Jamais d''auditeurs.';
