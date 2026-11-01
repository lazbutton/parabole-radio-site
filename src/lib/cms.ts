/**
 * La base du CMS, côté serveur : ouverte à la première requête qui en a besoin, puis gardée pour les suivantes (une
 * instance de fonction Vercel sert plusieurs requêtes). DATABASE_URL vise Supabase ; vide en local, c'est la base
 * PGlite de cms/.pglite (cms/README.md, « Travailler en local »).
 */
import { connect, type Db } from "@parabole/cms";
import { DATABASE_URL } from "astro:env/server";

// Gardée sur globalThis : en développement, Vite recharge ce module à chaque modification, et PGlite n'ouvre sa base
// que pour un seul processus.
const shared = globalThis as typeof globalThis & { paraboleCms?: Promise<Db> };

export function database(): Promise<Db> {
  shared.paraboleCms ??= connect({ url: DATABASE_URL }).then(
    (connection) => connection.db,
    (error: unknown) => {
      // Rien de gardé après un échec : la requête suivante réessaie.
      shared.paraboleCms = undefined;
      throw error;
    },
  );
  return shared.paraboleCms;
}
