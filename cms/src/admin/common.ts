/**
 * Ce que partagent les lectures et les écritures de l'admin : le jeton de version d'une fiche, les adresses libres,
 * les résultats d'un enregistrement.
 */
import { and, eq, like, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "../access.ts";
import { artist, event, show } from "../schema.ts";
import type { FieldErrors } from "./input.ts";

/**
 * Le jeton de version d'une fiche : sa date de modification, à la microseconde près (un Date JavaScript s'arrête à la
 * milliseconde). L'écran le renvoie avec la fiche ; s'il a changé entre-temps, quelqu'un d'autre a enregistré.
 */
export const versionOf = (updatedAt: AnyPgColumn) => sql<string>`((extract(epoch from ${updatedAt}) * 1000000)::bigint)::text`;

/** Une adresse libre pour ce show, cet artiste ou cet événement : `base`, sinon `base-2`, `base-3`… */
export async function freeSlug(tx: Tx, table: typeof show | typeof artist | typeof event, base: string, exceptId?: string): Promise<string> {
  const rows = await tx
    .select({ slug: table.slug })
    .from(table)
    .where(and(or(eq(table.slug, base), like(table.slug, `${base}-%`)), exceptId ? ne(table.id, exceptId) : undefined));
  const taken = new Set(rows.map((row) => row.slug));
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** Un enregistrement réussi : l'identifiant de la fiche, et ce qu'il a créé en passant. */
export type Saved = { ok: true; id: string; slug: string; newArtists: string[]; newTags: string[] };
/**
 * Un enregistrement refusé : les erreurs par champ (« form » pour toute la fiche). `version` : la fiche a changé
 * depuis son ouverture ; le renvoyer avec la fiche confirme qu'on remplace la version de l'autre.
 */
export type NotSaved = { ok: false; errors: FieldErrors; version?: string };
