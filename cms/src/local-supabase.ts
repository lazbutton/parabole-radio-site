/**
 * Ce que Supabase fournit d'office et que PGlite n'a pas : les rôles de l'API (anon, authenticated, service_role), le
 * schéma auth avec sa table des comptes et ses fonctions (auth.uid(), auth.role(), auth.jwt()), et les droits par
 * défaut des rôles de l'API sur le schéma public. Recopié d'après l'image supabase/postgres (migrations/db) pour que
 * les migrations et les règles d'accès se comportent ici comme en ligne.
 *
 * Seulement pour PGlite (développement et tests) : sur Supabase, tout cela existe déjà. Rejouable sans effet.
 */
export const LOCAL_SUPABASE = /* sql */ `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id          uuid PRIMARY KEY,
  aud         varchar(255),
  role        varchar(255),
  email       varchar(255) UNIQUE,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- La personne connectée, telle que l'API de Supabase la pose pour chaque requête (request.jwt.claims).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$f$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Supabase Realtime, en imitation : la table des messages diffusés, son sujet, et un realtime.send() qui note ce qu'il
-- aurait diffusé (l'antenne libre, 0007_antenne_acces.sql). Sur Supabase, Realtime crée et garde ce schéma lui-même.
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic      text NOT NULL,
  extension  text NOT NULL,
  event      text,
  payload    jsonb,
  private    boolean DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('realtime.topic', true), '')
$f$;
CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
  LANGUAGE sql AS $f$
  INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (topic, 'broadcast', event, payload, private)
$f$;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
`;
