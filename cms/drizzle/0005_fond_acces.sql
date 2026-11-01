-- Les vidéos de fond (0004_fond.sql) : leurs règles d'accès, sur le modèle de 0002_acces.sql, puis les clips d'origine.

-- 1. Lire : le public voit les clips de la rotation (publiés), l'équipe voit tout. ------------------------------
CREATE POLICY background_clip_select ON public.background_clip FOR SELECT TO anon, authenticated
  USING (status = 'published' OR (SELECT private.is_team_member()));
--> statement-breakpoint

-- 2. Écrire : l'équipe, admin et éditeur, comme pour les autres contenus. ----------------------------------------
CREATE POLICY background_clip_insert ON public.background_clip FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY background_clip_update ON public.background_clip FOR UPDATE TO authenticated
  USING ((SELECT private.is_team_member())) WITH CHECK ((SELECT private.is_team_member()));
--> statement-breakpoint
CREATE POLICY background_clip_delete ON public.background_clip FOR DELETE TO authenticated
  USING ((SELECT private.is_team_member()));
--> statement-breakpoint

-- 3. Droits des rôles : le public ne fait que lire ; personne ne vide la table par l'API. ------------------------
REVOKE ALL ON public.background_clip FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.background_clip TO anon;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.background_clip TO authenticated;
--> statement-breakpoint

-- 4. Date de modification, et note pour le tableau de bord de Supabase. -------------------------------------------
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.background_clip FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
COMMENT ON TABLE public.background_clip IS 'Les vidéos du fond du site, dans l''ordre de la liste. Publiées : dans la rotation. Fichier dans le site (public/) ou sur Vercel Blob.';
--> statement-breakpoint

-- 5. Les 15 clips d'origine, livrés avec le site (public/PARABOLE RADIO/VIDEO/BACKGROUND/), dans l'ordre qu'ils
-- avaient dans src/scripts/settings.ts, avec leur image d'attente (la première image, en .jpg à côté).
INSERT INTO public.background_clip (position, title, video_url, poster_url, size_bytes, duration_seconds, width, height, status) VALUES
  (1, 'Baile Furacão 2000', '/PARABOLE RADIO/VIDEO/BACKGROUND/background.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background.jpg', 9603421, 126, 640, 360, 'published'),
  (2, 'babyfather – killuminatti', '/PARABOLE RADIO/VIDEO/BACKGROUND/background2.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background2.jpg', 4120021, 105, 640, 360, 'published'),
  (3, 'Daft Punk 1996', '/PARABOLE RADIO/VIDEO/BACKGROUND/background3.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background3.jpg', 3662317, 120, 640, 360, 'published'),
  (4, 'Kiss FM Paris (INA)', '/PARABOLE RADIO/VIDEO/BACKGROUND/background4.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background4.jpg', 2762599, 82, 480, 360, 'published'),
  (5, 'logobi Black Panthers', '/PARABOLE RADIO/VIDEO/BACKGROUND/background5.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background5.jpg', 1476608, 35, 640, 480, 'published'),
  (6, 'Etran de L''Aïr – Imouha', '/PARABOLE RADIO/VIDEO/BACKGROUND/background6.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background6.jpg', 5768945, 120, 540, 360, 'published'),
  (7, 'Mafia K1 Fry – Pour ceux', '/PARABOLE RADIO/VIDEO/BACKGROUND/background7.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background7.jpg', 8389621, 120, 640, 360, 'published'),
  (8, 'Pirate Radio London / Rush FM', '/PARABOLE RADIO/VIDEO/BACKGROUND/background8.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background8.jpg', 2609893, 120, 320, 240, 'published'),
  (9, 'Wah Wah Watson + Herbie Hancock', '/PARABOLE RADIO/VIDEO/BACKGROUND/background9.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background9.jpg', 3330410, 120, 480, 360, 'published'),
  (10, 'Ça va péter', '/PARABOLE RADIO/VIDEO/BACKGROUND/background10.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background10.jpg', 430326, 14, 640, 360, 'published'),
  (11, 'Nata Karim (série malienne)', '/PARABOLE RADIO/VIDEO/BACKGROUND/background11.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background11.jpg', 4956324, 120, 482, 360, 'published'),
  (12, 'Radio Cité Future / Radio Verte 1981 (INA)', '/PARABOLE RADIO/VIDEO/BACKGROUND/background12.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background12.jpg', 3608642, 120, 480, 360, 'published'),
  (13, 'Radio pirate mode d''emploi 1977 (INA)', '/PARABOLE RADIO/VIDEO/BACKGROUND/background13.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background13.jpg', 3173686, 120, 480, 360, 'published'),
  (14, 'Sankara / Zidane', '/PARABOLE RADIO/VIDEO/BACKGROUND/background14.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background14.jpg', 3342423, 120, 320, 240, 'published'),
  (15, '', '/PARABOLE RADIO/VIDEO/BACKGROUND/background15.mp4', '/PARABOLE RADIO/VIDEO/BACKGROUND/background15.jpg', 2096898, 33, 720, 458, 'published');
