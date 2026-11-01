/**
 * Les artistes dans l'admin : l'index A–Z (brouillons compris), la fiche à modifier avec ses shows, l'enregistrement,
 * la suppression. Sous le rôle de la personne connectée (src/admin/index.ts).
 */
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { indexLetter } from "../read/artists.ts";
import { frenchOrder, oneOf, outer } from "../read/common.ts";
import { escapeLike, prefixQuery } from "../read/search.ts";
import { artist, artistRole, contentStatus, eventArtist, media, SEARCH_CONFIG, show, showArtist, type ArtistLink, type ArtistRole, type ContentStatus, type ShowType } from "../schema.ts";
import { freeSlug, versionOf, type NotSaved, type Saved } from "./common.ts";
import { isUuid, type ArtistValues } from "./input.ts";

export type AdminArtistRow = { id: string; slug: string; name: string; role: ArtistRole; status: ContentStatus; shows: number; hasPhoto: boolean; updatedAt: Date };

/** L'index A–Z de l'admin : une lettre par groupe, « # » à la fin. */
export type AdminArtistIndex = { total: number; groups: { letter: string; artists: AdminArtistRow[] }[] };

export type AdminArtistFilters = { q?: string; role?: string; status?: string };

/** La recherche sur le nom et la bio, sans les accents ni les majuscules. */
function matching(input: string): SQL | undefined {
  const query = input.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 200);
  const words = prefixQuery(query);
  if (!words) return undefined;
  const plain = sql`private.immutable_unaccent(lower(${escapeLike(query)}))`;
  return sql`(${artist.search} @@ to_tsquery(${sql.raw(`'${SEARCH_CONFIG}'::regconfig`)}, ${words})
    or private.immutable_unaccent(lower(${artist.name})) like '%' || ${plain} || '%')`;
}

/** Les artistes, brouillons compris, rangés par lettre dans l'ordre alphabétique français. */
export async function listArtists(tx: Tx, filters: AdminArtistFilters = {}): Promise<AdminArtistIndex> {
  const conditions: (SQL | undefined)[] = [];
  if (filters.q) conditions.push(matching(filters.q));
  if (filters.role && oneOf(artistRole.enumValues, filters.role)) conditions.push(eq(artist.role, filters.role));
  if (filters.status && oneOf(contentStatus.enumValues, filters.status)) conditions.push(eq(artist.status, filters.status));
  const rows = await tx
    .select({
      id: artist.id,
      slug: artist.slug,
      name: artist.name,
      role: artist.role,
      status: artist.status,
      shows: sql<number>`(select count(*) from ${showArtist} sa where sa.artist_id = ${outer(artist.id)})`.mapWith(Number),
      hasPhoto: sql<boolean>`${artist.photoId} is not null`,
      updatedAt: artist.updatedAt,
    })
    .from(artist)
    .where(and(...conditions));
  rows.sort((a, b) => frenchOrder.compare(a.name, b.name));
  const groups = new Map<string, AdminArtistRow[]>();
  for (const row of rows) {
    const letter = indexLetter(row.name);
    groups.set(letter, [...(groups.get(letter) ?? []), row]);
  }
  return {
    total: rows.length,
    groups: [...groups].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))).map(([letter, artists]) => ({ letter, artists })),
  };
}

export type AdminArtist = {
  id: string;
  slug: string;
  name: string;
  role: ArtistRole;
  status: ContentStatus;
  bio: string | null;
  links: ArtistLink[];
  radiocultArtistId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Jeton de version (src/admin/common.ts), à renvoyer avec la fiche. */
  version: string;
  photo: { key: string; alt: string } | null;
  /** Ses shows, brouillons compris, du plus récent au plus ancien. */
  shows: { id: string; title: string; type: ShowType; status: ContentStatus; broadcastAt: Date | null }[];
  /** Le nombre de ses événements. */
  events: number;
};

/** Un artiste à modifier, brouillon compris, avec ses shows. Null s'il n'existe pas. */
export async function getArtist(tx: Tx, id: string): Promise<AdminArtist | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select({
      id: artist.id,
      slug: artist.slug,
      name: artist.name,
      role: artist.role,
      status: artist.status,
      bio: artist.bio,
      links: artist.links,
      radiocultArtistId: artist.radiocultArtistId,
      createdAt: artist.createdAt,
      updatedAt: artist.updatedAt,
      version: versionOf(artist.updatedAt),
      photoId: artist.photoId,
      events: sql<number>`(select count(*) from ${eventArtist} ea where ea.artist_id = ${outer(artist.id)})`.mapWith(Number),
    })
    .from(artist)
    .where(eq(artist.id, id))
    .limit(1);
  if (!row) return null;
  const { photoId, ...fields } = row;
  const [photo] = photoId ? await tx.select({ key: media.key, alt: media.alt }).from(media).where(eq(media.id, photoId)) : [];
  const shows = await tx
    .select({ id: show.id, title: show.title, type: show.type, status: show.status, broadcastAt: show.broadcastAt })
    .from(showArtist)
    .innerJoin(show, eq(show.id, showArtist.showId))
    .where(eq(showArtist.artistId, id))
    .orderBy(sql`${show.broadcastAt} desc nulls first`, desc(show.updatedAt));
  return { ...fields, photo: photo ?? null, shows };
}

export type ArtistSave = {
  /** Absent : un artiste nouveau. */
  id?: string;
  /** Le jeton de version lu à l'ouverture de la fiche. */
  version?: string;
  values: ArtistValues;
  /** Publier ou dépublier en même temps. Absent : le statut ne change pas (brouillon pour un artiste nouveau). */
  status?: ContentStatus;
};

/** Enregistre un artiste. Les vérifications passent avant l'écriture ; une erreur de la base annule tout. */
export async function saveArtist(tx: Tx, { id, version, values, status }: ArtistSave): Promise<Saved | NotSaved> {
  if (id !== undefined) {
    const gone: NotSaved = { ok: false, errors: { form: "Cet artiste n'existe plus : il a peut-être été supprimé." } };
    if (!isUuid(id)) return gone;
    const [current] = await tx.select({ version: versionOf(artist.updatedAt) }).from(artist).where(eq(artist.id, id)).for("update");
    if (!current) return gone;
    if (version !== undefined && version !== current.version)
      return {
        ok: false,
        version: current.version,
        errors: { form: "Quelqu'un a enregistré cette fiche pendant que tu la modifiais. Enregistre de nouveau pour remplacer sa version par la tienne." },
      };
  }
  let slug = values.slug;
  const [clash] = await tx
    .select({ name: artist.name })
    .from(artist)
    .where(and(eq(artist.slug, slug), id ? ne(artist.id, id) : undefined))
    .limit(1);
  if (clash) {
    if (!values.slugFromTitle) return { ok: false, errors: { slug: `Cette adresse sert déjà à « ${clash.name} ».` } };
    slug = await freeSlug(tx, artist, slug, id);
  }
  const fields = { slug, name: values.name, role: values.role, bio: values.bio, links: values.links, ...(status ? { status } : {}) };
  if (id) {
    await tx.update(artist).set(fields).where(eq(artist.id, id));
    return { ok: true, id, slug, newArtists: [], newTags: [] };
  }
  const [created] = await tx.insert(artist).values(fields).returning({ id: artist.id });
  return { ok: true, id: created!.id, slug, newArtists: [], newTags: [] };
}

/** Supprime un artiste : il disparaît des shows et des événements qui le citaient. Rend son nom. */
export async function deleteArtist(tx: Tx, id: string): Promise<{ name: string } | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(artist).where(eq(artist.id, id)).returning({ name: artist.name });
  return removed ?? null;
}
