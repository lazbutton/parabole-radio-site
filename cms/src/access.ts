/**
 * Lire et écrire sous un rôle de Supabase, pour que les règles d'accès (drizzle/0002_acces.sql) s'appliquent.
 *
 * La connexion du serveur est celle du propriétaire des tables, que la sécurité par ligne laisse passer. Chaque
 * lecture ou écriture prend donc, le temps de sa transaction, le rôle de qui la demande, comme le fait l'API de
 * Supabase : anon pour le site public, authenticated et l'identifiant de son compte pour une personne de l'équipe.
 */
import { sql } from "drizzle-orm";
import type { Db } from "./db.ts";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Qui demande : le public, ou une personne connectée. Son identifiant vient d'une session vérifiée par Supabase Auth
 * (supabase.auth.getUser() côté serveur), jamais d'un champ de formulaire.
 */
export type Viewer = { role: "anon" } | { role: "authenticated"; userId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withViewer<T>(db: Db, viewer: Viewer, run: (tx: Tx) => Promise<T>, { readOnly = false } = {}): Promise<T> {
  if (viewer.role === "authenticated" && !UUID.test(viewer.userId)) throw new Error(`Identifiant de compte invalide : « ${viewer.userId} ».`);
  const sub = viewer.role === "authenticated" ? viewer.userId : "";
  const claims = JSON.stringify(viewer.role === "anon" ? { role: "anon" } : { sub, role: "authenticated" });
  return db.transaction(
    async (tx) => {
      // Locaux à la transaction (troisième argument à true) : la connexion retrouve ensuite son rôle de propriétaire.
      // L'identité sous ses deux formes, comme le fait Supabase : auth.uid() lit request.jwt.claims, ou, dans ses
      // versions anciennes (encore celle de l'image Docker supabase/postgres), request.jwt.claim.sub.
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${sub}, true),
        set_config('request.jwt.claim.role', ${viewer.role}, true), set_config('role', ${viewer.role}, true)`);
      return run(tx);
    },
    readOnly ? { accessMode: "read only" } : undefined,
  );
}

/** Les lectures du site : rôle anon, en lecture seule. Seul le publié est visible. */
export const asPublic = <T>(db: Db, run: (tx: Tx) => Promise<T>): Promise<T> => withViewer(db, { role: "anon" }, run, { readOnly: true });

/** Les écrans d'admin : une personne de l'équipe, avec les droits de son rôle (admin ou éditeur). */
export const asMember = <T>(db: Db, userId: string, run: (tx: Tx) => Promise<T>): Promise<T> => withViewer(db, { role: "authenticated", userId }, run);
