/**
 * Pour les tests : une base neuve et migrée, avec le jeu d'exemples daté d'un instant fixe.
 *
 * Par défaut, PGlite en mémoire : aucun compte Supabase, aucun réseau, aucun serveur. Avec TEST_DATABASE_URL, une
 * base créée pour l'occasion sur ce serveur Postgres, puis effacée : l'image supabase/postgres lancée dans Docker
 * (cms/README.md, « Tests »), pour vérifier aussi le Postgres et les rôles de Supabase.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { seedExamples } from "../seed/exemples.ts";
import { connect, type Connection, type Db } from "../src/db.ts";
import { LOCAL_SUPABASE } from "../src/local-supabase.ts";
import { member, type TeamRole } from "../src/schema.ts";

/** Samedi 13 juin 2026, midi à Paris (10 h en heure universelle, heure d'été). */
export const NOW = new Date("2026-06-13T10:00:00Z");
export const MEDIA_BASE = "https://media.example.test";

/** Les tests tournent-ils sur PGlite (par défaut) ou sur un serveur Postgres (TEST_DATABASE_URL) ? */
export const ON_SERVER = Boolean(process.env.TEST_DATABASE_URL);

/** Une base vide et migrée, rien que pour l'appelant. */
export async function freshDb(): Promise<Connection> {
  const server = process.env.TEST_DATABASE_URL;
  if (!server) return connect({ dataDir: "memory://" });
  const name = `cms_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = postgres(server, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  // Les rôles de Supabase existent déjà sur le serveur ; le schéma auth est recréé dans cette base neuve.
  const setup = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await setup.unsafe(LOCAL_SUPABASE);
  await setup.end();
  const connection = await connect({ url: url.toString() });
  await connection.migrate();
  return {
    ...connection,
    close: async () => {
      await connection.close();
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

export async function exampleDb(): Promise<Connection> {
  const connection = await freshDb();
  await seedExamples(connection.db, { now: NOW });
  return connection;
}

/**
 * Un compte Supabase Auth simulé (auth.users de local-supabase.ts) et, si un rôle est donné, sa fiche de membre.
 * Écrit par le propriétaire, comme le ferait l'invitation d'un admin.
 */
export async function createAccount(db: Db, role?: TeamRole): Promise<string> {
  const id = randomUUID();
  const email = `${id.slice(0, 8)}@exemple.test`;
  await db.execute(sql`insert into auth.users (id, email, role, aud) values (${id}, ${email}, 'authenticated', 'authenticated')`);
  if (role) await db.insert(member).values({ userId: id, email, name: `Membre ${role}`, role });
  return id;
}

/** Les lignes d'un db.execute() : PGlite les range dans « rows », postgres-js les rend directement. */
export const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows);

/** L'erreur Postgres derrière un échec : Drizzle l'enveloppe (« Failed query… ») et garde l'originale dans « cause ». */
export async function pgError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const original = (error as { cause?: unknown }).cause ?? error;
    return { code: (original as { code?: string }).code, message: (original as Error).message };
  }
  throw new Error("La requête devait échouer et elle a réussi.");
}
