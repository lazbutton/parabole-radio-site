-- La page À propos (0014_a_propos.sql) : ses règles d'accès, sur le modèle de 0005_fond_acces.sql, puis sa ligne, avec
-- ce que disait la page provisoire du site. Et les mentions légales, sur une page à part (page « mentions-legales »).
-- Aucun point-virgule dans les textes : l'éditeur SQL de Supabase coupe les requêtes aux points-virgules.

-- 1. Lire : tout le monde, la page est toujours en ligne. Modifier : l'équipe, admin et éditeur. ---------------------
-- Ni ajout ni suppression : la ligne est unique, posée ici.
CREATE POLICY about_page_select ON public.about_page FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY about_page_update ON public.about_page FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 2. Droits des rôles : le public ne fait que lire ; personne ne vide la table par l'API. ------------------------
REVOKE ALL ON public.about_page FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.about_page TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.about_page TO authenticated;
--> statement-breakpoint

-- 3. Date de modification, et note pour le tableau de bord de Supabase. -------------------------------------------
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.about_page FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
COMMENT ON TABLE public.about_page IS 'La page À propos, sur une seule ligne : description, réseaux, équipe, crédits, contact, candidater, et le film qu''on y lance.';
--> statement-breakpoint

-- 4. Sa ligne : le texte de la page provisoire, les réseaux de la ligne du bas (sans YouTube, dont l'adresse répond
-- 404), le formulaire des contributeurs (src/scripts/settings.ts), et les emprunts que crédite le code du site.
INSERT INTO public.about_page (description, socials, credits, apply_text, apply_url) VALUES (
  'Webradio communautaire du 18ᵉ arrondissement de Paris : Union de la Jeunesse Internationale Community Radio. Le direct tourne 24 h sur 24 : de la musique en continu, des émissions et des sets.',
  '[{"label": "Instagram", "url": "https://www.instagram.com/paraboleradio/"}, {"label": "SoundCloud", "url": "https://soundcloud.com/parabole-radio"}]',
  '[{"role": "Filtre cathodique", "name": "d''après « CRT scanline filter » de Tellers, CC BY 4.0", "url": "https://tellers.ai/free-svg-vfx/crt-scanline-filter"}, {"role": "Allumage et neige", "name": "d''après « CRT TV Effect » de Karl Saunders", "url": "https://codepen.io/Mobius1/pen/zZpoXj"}, {"role": "Icônes", "name": "Font Awesome Free, CC BY 4.0", "url": "https://fontawesome.com/license/free"}]',
  'La radio cherche des contributeurs : DJ, podcasteurs, spécialistes d''un genre, passionnés de musique.',
  'https://docs.google.com/forms/d/e/1FAIpQLSdd0G1tn5WbVDM4stWcq4IiSMGGaEQ2Ldpd83fDWgAR0H1TPQ/viewform?usp=dialog'
);
--> statement-breakpoint

-- 5. Les mentions légales, obligatoires pour un site publié en France (LCEN) : ce qui est connu, et ce qui reste à
-- compléter dans l'admin (À propos). Des intitulés en gras plutôt que des titres : l'éditeur de texte de l'admin n'en
-- fait pas. Une page déjà écrite sous cette adresse reste telle quelle.
INSERT INTO public.page (slug, title, status, body) VALUES ('mentions-legales', 'Mentions légales', 'published',
'**Éditeur**
Parabole Radio, webradio communautaire du 18ᵉ arrondissement de Paris.
**À compléter :** le nom de la personne ou de la structure qui édite le site, son adresse, et un moyen de la joindre (e-mail ou téléphone).

**Directeur ou directrice de la publication**
**À compléter :** son nom.

**Hébergeur**
Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis. [vercel.com](https://vercel.com)')
ON CONFLICT (slug) DO NOTHING;
