/**
 * La base du CMS, côté serveur : ouverte à la première requête qui en a besoin, puis gardée pour les suivantes (une
 * instance de fonction Vercel sert plusieurs requêtes). DATABASE_URL vise Supabase ; vide en local, c'est la base
 * PGlite de cms/.pglite (cms/README.md, « Travailler en local »).
 */
import { connect, createReader, type Db, type Reader } from "@parabole/cms";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";
import { DATABASE_URL, PUBLIC_MEDIA_URL } from "astro:env/server";

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

/** L'adresse publique du seau des images : PUBLIC_MEDIA_URL, sinon le seau « media » du projet Supabase. */
const mediaBaseUrl = PUBLIC_MEDIA_URL || (PUBLIC_SUPABASE_URL ? `${PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/media` : "");

/** Les lectures du site (cms/src/read) : sous le rôle du public, elles ne voient que le publié. */
export async function reader(): Promise<Reader> {
  return createReader(await database(), { mediaBaseUrl });
}
