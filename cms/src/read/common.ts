/**
 * Ce que partagent les lectures : les fichiers devenus images, la pagination, le tri à la française, le jour de Paris.
 */
import { getTableName, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { media, type ArtistRole, type MediaVariant, type TagKind } from "../schema.ts";

// ---------------------------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------------------------

/** Un fichier tel qu'une requête de lecture le rend (json_build_object). */
export type MediaRow = { key: string; width: number | null; height: number | null; alt: string; credit: string | null; variants: MediaVariant[] };

/** Une image prête pour <img> : adresse publique sur R2, dimensions, texte alternatif, crédit, versions pour srcset. */
export type Image = { url: string; width: number | null; height: number | null; alt: string; credit: string | null; srcset: string | null };

/** L'adresse publique d'un fichier : l'adresse du seau R2 (PUBLIC_MEDIA_URL) suivie de sa clé. */
export const mediaUrl = (base: string, key: string): string => `${base.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;

export function toImage(base: string, row: MediaRow | null | undefined): Image | null {
  if (!row) return null;
  // Les versions réduites, plus l'original quand sa largeur est connue, de la plus petite à la plus grande.
  const widths = new Map<number, string>(row.variants.map((variant) => [variant.width, variant.key]));
  if (row.width && !widths.has(row.width)) widths.set(row.width, row.key);
  const srcset = row.variants.length
    ? [...widths]
        .sort(([a], [b]) => a - b)
        .map(([width, key]) => `${mediaUrl(base, key)} ${width}w`)
        .join(", ")
    : null;
  return { url: mediaUrl(base, row.key), width: row.width, height: row.height, alt: row.alt, credit: row.credit, srcset };
}

/**
 * Une colonne de la requête principale, nommée avec sa table (« "show"."id" »), pour une sous-requête. Dans la liste
 * des colonnes d'une requête sans jointure, Drizzle l'écrirait sans sa table (« "id" ») et Postgres la chercherait
 * d'abord dans la sous-requête : « sa.show_id = "id" » y deviendrait « sa.show_id = a.id ».
 */
export const outer = (column: AnyPgColumn): SQL => sql.raw(`"${getTableName(column.table)}"."${column.name}"`);

/** Le fichier d'une colonne (pochette, photo, visuel), en JSON dans la même requête. Null s'il n'est pas visible. */
export const mediaJson = (id: AnyPgColumn) =>
  sql<MediaRow | null>`(select json_build_object('key', m.key, 'width', m.width, 'height', m.height, 'alt', m.alt, 'credit', m.credit, 'variants', m.variants)
    from ${media} m where m.id = ${outer(id)})`;

// ---------------------------------------------------------------------------------------------------------------
// Références croisées
// ---------------------------------------------------------------------------------------------------------------

/** Un artiste cité par un show ou un événement : de quoi l'afficher et faire un lien vers sa page. */
export type ArtistRef = { slug: string; name: string; role: ArtistRole };
/** Une étiquette de show. */
export type TagRef = { kind: TagKind; slug: string; name: string };

// ---------------------------------------------------------------------------------------------------------------
// Listes
// ---------------------------------------------------------------------------------------------------------------

export type Paged<T> = { items: T[]; total: number; limit: number; offset: number };

/** limit entre 1 et 100 (24 par défaut), offset positif : des valeurs lues dans une adresse ne cassent rien. */
export function paging({ limit, offset }: { limit?: number; offset?: number }, fallback = 24): { limit: number; offset: number } {
  const whole = (value: number | undefined, otherwise: number) => (Number.isFinite(value) ? Math.trunc(value as number) : otherwise);
  return { limit: Math.min(100, Math.max(1, whole(limit, fallback))), offset: Math.max(0, whole(offset, 0)) };
}

export const emptyPage = <T>({ limit, offset }: { limit: number; offset: number }): Paged<T> => ({ items: [], total: 0, limit, offset });

/** Ordre alphabétique français : « Éloïse » avec les E, « 2 » avant « 10 ». */
export const frenchOrder = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

// ---------------------------------------------------------------------------------------------------------------
// Le jour de Paris (src/paris.ts, partagé avec l'admin)
// ---------------------------------------------------------------------------------------------------------------

export { STATION_TIME_ZONE, startOfParisDay } from "../paris.ts";
