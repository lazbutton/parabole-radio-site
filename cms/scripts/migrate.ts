/**
 * Applique les migrations en attente (drizzle/). Sans DATABASE_URL : la base locale PGlite (cms/.pglite). Avec : la
 * base de Supabase, par le pooler en mode session (port 5432) ou la connexion directe (cms/README.md).
 *
 *   npm run db:migrate
 */
import { connect } from "../src/db.ts";

// Les variables de cms/.env, s'il existe (DATABASE_URL).
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}

const { kind, migrate, close } = await connect();
try {
  await migrate();
} finally {
  await close();
}
console.log(kind === "pglite" ? "Base locale (PGlite) à jour." : "Base Supabase à jour.");
