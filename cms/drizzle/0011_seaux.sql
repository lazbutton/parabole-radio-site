-- Les seaux de Supabase Storage pour les images (README, 9.3) :
--   - « originaux », privé : les fichiers tels qu'envoyés depuis l'admin, avec leurs métadonnées (dont la position GPS) ;
--   - « media », public : les versions WebP que le site affiche, lues par leur adresse publique (PUBLIC_MEDIA_URL).
--
-- Seul le serveur y écrit, avec la clé secrète (src/lib/admin/storage.ts du site) : aucune règle d'accès sur
-- storage.objects. Sans règle, ni le navigateur ni la clé publiable ne peuvent y écrire ni y lister quoi que ce soit.
-- Les limites ci-dessous sont une seconde barrière : le serveur vérifie déjà le type et le poids avant de signer un
-- envoi. Rejouable : un seau déjà là reprend ces réglages.
--
-- Sur Supabase, le Storage crée et garde lui-même son schéma ; une base sans Storage (PGlite sans son imitation) n'a
-- pas de seaux à créer.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('originaux', 'originaux', false, 25000000, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
    ('media', 'media', true, 5000000, ARRAY['image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
END $$;
