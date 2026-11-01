/**
 * La connexion à la base.
 *   - Supabase (DATABASE_URL) : le Postgres du projet. Sur Vercel, par le pooler en mode transaction (port 6543),
 *     sans requêtes préparées. Les migrations ne s'y appliquent qu'à la demande (npm run db:migrate, migrate()).
 *   - Sans adresse, PGlite : un vrai Postgres dans le processus, sans compte ni serveur, pour développer (dossier
 *     cms/.pglite) et tester (« memory:// »). Ce que Supabase fournit d'office y est recréé (local-supabase.ts), puis
 *     les migrations s'appliquent à l'ouverture.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Connection = {
  db: Db;
  /** « supabase » : une base Postgres par son adresse ; « pglite » : la base locale. */
  kind: "supabase" | "pglite";
  /** Applique les migrations en attente (drizzle/), une seule fois chacune. Déjà fait à l'ouverture pour PGlite. */
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

export type ConnectOptions = {
  /** Adresse Postgres. Par défaut DATABASE_URL ; vide, PGlite. */
  url?: string;
  /** Dossier de PGlite, ou « memory:// ». Par défaut PGLITE_DIR, sinon cms/.pglite. */
  dataDir?: string;
};

// Chemins calculés, et non new URL("…", import.meta.url) : Vite prendrait ce motif pour un fichier à empaqueter.
const CMS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_FOLDER = join(CMS_DIR, "drizzle");
const LOCAL_DIR = join(CMS_DIR, ".pglite");

/** Machine locale, réseau privé ou service Docker (sans point) : pas de chiffrement exigé. Sinon TLS obligatoire. */
function privateHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return host === "localhost" || host === "::1" || !host.includes(".") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

/**
 * L'adresse avec son mot de passe encodé. Celui que génère Supabase contient souvent « # », « & » ou « + », qui coupent
 * une adresse collée telle quelle ; on l'encode ici. Le message d'erreur ne recopie jamais l'adresse.
 */
export function normalizeDatabaseUrl(url: string): string {
  try {
    new URL(url);
    return url;
  } catch {}
  const parts = url.match(/^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@]+)$/s);
  if (parts) {
    const [, scheme, user, password, rest] = parts;
    const fixed = `${scheme}${user}:${encodeURIComponent(password!)}@${rest}`;
    try {
      new URL(fixed);
      return fixed;
    } catch {}
  }
  throw new Error("DATABASE_URL illisible : attendu postgresql://utilisateur:mot-de-passe@hôte:port/base (cms/README.md).");
}

export async function connect({ url = process.env.DATABASE_URL, dataDir = process.env.PGLITE_DIR || LOCAL_DIR }: ConnectOptions = {}): Promise<Connection> {
  if (url) {
    url = normalizeDatabaseUrl(url);
    // sslmode dans l'adresse l'emporte toujours.
    const ssl = privateHost(url) || /sslmode=/.test(url) ? undefined : "require";
    const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20, ssl, onnotice: () => {}, connection: { application_name: "parabole-cms" } });
    const db = drizzlePostgres(client, { schema });
    const migrate = async () => {
      const { migrate: run } = await import("drizzle-orm/postgres-js/migrator");
      await run(db, { migrationsFolder: MIGRATIONS_FOLDER });
    };
    return { db: db as unknown as Db, kind: "supabase", migrate, close: () => client.end() };
  }
  // Vercel n'a pas de disque durable : sans Supabase, tout ce que l'équipe saisirait serait perdu.
  if (process.env.VERCEL) throw new Error("DATABASE_URL manquante : en ligne, la base est celle de Supabase (cms/README.md).");
  // Chargés seulement ici : en production, ni PGlite ni son Postgres en WebAssembly ne ralentissent le démarrage.
  const [{ PGlite }, { unaccent }, { drizzle: drizzlePglite }, { migrate: run }, { LOCAL_SUPABASE }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/unaccent"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("./local-supabase.ts"),
  ]);
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir, { extensions: { unaccent } });
  await client.exec(LOCAL_SUPABASE);
  const db = drizzlePglite(client, { schema });
  const migrate = () => run(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await migrate();
  return { db: db as unknown as Db, kind: "pglite", migrate, close: () => client.close() };
}
