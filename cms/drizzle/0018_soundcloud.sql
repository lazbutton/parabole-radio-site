-- La publication sur SoundCloud (cms/README.md, 9.14) : le compte SoundCloud de Parabole, relié une fois par un admin
-- (OAuth 2.1 avec PKCE). Une seule ligne. Ses jetons ne quittent pas le serveur : la table vit dans le schéma
-- « private », que l'API de Supabase ne publie pas, et personne d'autre que le propriétaire des tables (la connexion du
-- site) n'y a de droit. Le jeton d'accès dure une heure ; chaque refresh token ne sert qu'une fois : le serveur garde
-- le nouveau à chaque renouvellement, la ligne verrouillée (FOR UPDATE) pour qu'aucun autre envoi ne le gaspille.
CREATE TABLE private.soundcloud_account (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_urn text NOT NULL,
  username text NOT NULL,
  permalink_url text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scope text,
  linked_by uuid REFERENCES public.member (user_id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz
);
--> statement-breakpoint
REVOKE ALL ON private.soundcloud_account FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
COMMENT ON TABLE private.soundcloud_account IS 'Le compte SoundCloud de Parabole, relié par un admin : ses jetons OAuth (le refresh token ne sert qu''une fois). Une seule ligne, hors de l''API.';
