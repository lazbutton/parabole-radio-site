/**
 * drizzle-kit : `npm run db:generate` tire une migration de src/schema.ts, `npm run db:custom -- --name=…` crée une
 * migration vide à écrire à la main (règles d'accès, fonctions, déclencheurs). Les migrations s'appliquent avec
 * `npm run db:migrate` (scripts/migrate.ts), sur PGlite en local ou sur Supabase avec DATABASE_URL.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
