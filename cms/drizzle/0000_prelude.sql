-- Prélude, écrit à la main : ce dont les tables ont besoin avant d'exister.
--
-- 1. L'extension unaccent, pour une recherche insensible aux accents. Supabase range les extensions dans le schéma
--    « extensions » ; si unaccent y est déjà, ou ailleurs, on la prend où elle est.
-- 2. La configuration de recherche public.french_unaccent : les mots français, sans accents, ramenés à leur racine
--    (« Musiques électroniques » → 'musiqu' 'electron'). Les colonnes « search » des tables s'en servent.
-- 3. Le schéma « private », que l'API de Supabase ne publie pas : il range les fonctions des règles d'accès
--    (0002_acces.sql) et private.immutable_unaccent(), qui compare et trie des noms sans leurs accents.

CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS private;
--> statement-breakpoint
DO $$
DECLARE
  home text := (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'unaccent');
BEGIN
  -- unaccent() n'est que STABLE (son dictionnaire pourrait changer) ; nommer le dictionnaire la rend sûre à indexer.
  EXECUTE format(
    'CREATE FUNCTION private.immutable_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '''' RETURN %I.unaccent(%L::regdictionary, $1)',
    home, home || '.unaccent');
  CREATE TEXT SEARCH CONFIGURATION public.french_unaccent (COPY = pg_catalog.french);
  EXECUTE format(
    'ALTER TEXT SEARCH CONFIGURATION public.french_unaccent ALTER MAPPING FOR hword, hword_part, word WITH %I.unaccent, french_stem',
    home);
END $$;
