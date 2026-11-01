/**
 * Les shows pour le site : la liste filtrée (type, genre, mood, thème, artiste), un show avec sa tracklist et ses
 * artistes, les étiquettes qui servent de filtres.
 */
import { and, asc, desc, eq, gt, lte, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { artist, show, showArtist, showTag, showType, tag, tagKind, track, type ShowType, type TagKind } from "../schema.ts";
import { isSlug } from "../slug.ts";
import { emptyPage, frenchOrder, mediaJson, oneOf, outer, paging, toImage, type ArtistRef, type Image, type MediaRow, type Paged, type TagRef } from "./common.ts";

/** Une vignette de show : ce que montrent les grilles et les rangées (titre, artistes, date, étiquettes). */
export type ShowCard = {
  slug: string;
  title: string;
  type: ShowType;
  broadcastAt: Date;
  durationSeconds: number | null;
  cover: Image | null;
  artists: ArtistRef[];
  tags: TagRef[];
};

export type ShowTrack = { position: number; artist: string; title: string; startSeconds: number | null; hopperUrl: string | null };

/** La page d'un show. Le lecteur joue soundcloudTrackId ; soundcloudUrl mène à la piste sur SoundCloud. */
export type ShowDetail = ShowCard & {
  description: string | null;
  soundcloudUrl: string | null;
  soundcloudTrackId: string | null;
  radiocultEventId: string | null;
  updatedAt: Date;
  tracks: ShowTrack[];
};

export type ShowFilters = {
  type?: ShowType;
  /** Slugs d'étiquettes : un par type d'étiquette. */
  genre?: string;
  mood?: string;
  theme?: string;
  /** Slug d'artiste. */
  artist?: string;
  /** Déjà diffusés (les archives), ou à venir. Sans période : tous. */
  period?: "past" | "upcoming";
  /** L'instant de référence pour la période (maintenant par défaut). */
  now?: Date;
  limit?: number;
  offset?: number;
};

// Les artistes publiés et les étiquettes d'un show, en JSON dans la requête du show (une seule requête par liste).
const showArtists = sql<ArtistRef[]>`coalesce((
    select json_agg(json_build_object('slug', a.slug, 'name', a.name, 'role', a.role) order by sa.position, a.name)
    from ${showArtist} sa join ${artist} a on a.id = sa.artist_id
    where sa.show_id = ${outer(show.id)} and a.status = 'published'), '[]'::json)`;
const showTags = sql<TagRef[]>`coalesce((
    select json_agg(json_build_object('kind', t.kind, 'slug', t.slug, 'name', t.name) order by t.kind, t.name)
    from ${showTag} st join ${tag} t on t.id = st.tag_id
    where st.show_id = ${outer(show.id)}), '[]'::json)`;

/** Les colonnes d'une vignette, pour toute requête sur « show » (listes, page d'artiste, recherche). */
export const showCardFields = {
  slug: show.slug,
  title: show.title,
  type: show.type,
  broadcastAt: show.broadcastAt,
  durationSeconds: show.durationSeconds,
  cover: mediaJson(show.coverId),
  artists: showArtists,
  tags: showTags,
};

type ShowCardRow = { slug: string; title: string; type: ShowType; broadcastAt: Date | null; durationSeconds: number | null; cover: MediaRow | null; artists: ArtistRef[]; tags: TagRef[] };

export const toShowCard = (base: string, row: ShowCardRow): ShowCard => ({
  slug: row.slug,
  title: row.title,
  type: row.type,
  // Un show publié a toujours une date (contrainte show_published_has_date).
  broadcastAt: row.broadcastAt as Date,
  durationSeconds: row.durationSeconds,
  cover: toImage(base, row.cover),
  artists: row.artists,
  tags: row.tags,
});

const hasTag = (kind: TagKind, slug: string) =>
  sql`exists (select 1 from ${showTag} st join ${tag} t on t.id = st.tag_id where st.show_id = ${outer(show.id)} and t.kind = ${kind} and t.slug = ${slug})`;
/** Un show de cet artiste (par l'identifiant ou le slug d'un artiste publié). */
export const hasArtist = (by: { id: string } | { slug: string }) =>
  "id" in by
    ? sql`exists (select 1 from ${showArtist} sa where sa.show_id = ${outer(show.id)} and sa.artist_id = ${by.id})`
    : sql`exists (select 1 from ${showArtist} sa join ${artist} a on a.id = sa.artist_id where sa.show_id = ${outer(show.id)} and a.slug = ${by.slug} and a.status = 'published')`;

/** Les conditions des filtres ; null quand un filtre ne peut rien donner (type inconnu, slug mal formé). */
function showConditions(filters: ShowFilters): SQL[] | null {
  const conditions: SQL[] = [eq(show.status, "published")];
  if (filters.type !== undefined) {
    if (!oneOf(showType.enumValues, filters.type)) return null;
    conditions.push(eq(show.type, filters.type));
  }
  for (const kind of tagKind.enumValues) {
    const slug = filters[kind];
    if (slug === undefined) continue;
    if (!isSlug(slug)) return null;
    conditions.push(hasTag(kind, slug));
  }
  if (filters.artist !== undefined) {
    if (!isSlug(filters.artist)) return null;
    conditions.push(hasArtist({ slug: filters.artist }));
  }
  const now = filters.now ?? new Date();
  if (filters.period === "past") conditions.push(lte(show.broadcastAt, now));
  else if (filters.period === "upcoming") conditions.push(gt(show.broadcastAt, now));
  return conditions;
}

/** Les shows publiés, du plus récent au plus ancien (les à venir : du plus proche au plus lointain). */
export async function listShows(tx: Tx, base: string, filters: ShowFilters = {}): Promise<Paged<ShowCard>> {
  const page = paging(filters);
  const conditions = showConditions(filters);
  if (!conditions) return emptyPage(page);
  const where = and(...conditions);
  const order = filters.period === "upcoming" ? asc(show.broadcastAt) : desc(show.broadcastAt);
  const rows = await tx.select(showCardFields).from(show).where(where).orderBy(order, asc(show.title)).limit(page.limit).offset(page.offset);
  const [count] = await tx.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(show).where(where);
  return { items: rows.map((row) => toShowCard(base, row)), total: count?.total ?? 0, ...page };
}

/** Un show publié, avec sa tracklist dans l'ordre et ses artistes. Null s'il n'existe pas ou n'est pas publié. */
export async function getShow(tx: Tx, base: string, slug: string): Promise<ShowDetail | null> {
  if (!isSlug(slug)) return null;
  const [row] = await tx
    .select({
      id: show.id,
      ...showCardFields,
      description: show.description,
      soundcloudUrl: show.soundcloudUrl,
      soundcloudTrackId: show.soundcloudTrackId,
      radiocultEventId: show.radiocultEventId,
      updatedAt: show.updatedAt,
    })
    .from(show)
    .where(and(eq(show.slug, slug), eq(show.status, "published")))
    .limit(1);
  if (!row) return null;
  const tracks = await tx
    .select({ position: track.position, artist: track.artist, title: track.title, startSeconds: track.startSeconds, hopperUrl: track.hopperUrl })
    .from(track)
    .where(eq(track.showId, row.id))
    .orderBy(asc(track.position));
  return {
    ...toShowCard(base, row),
    description: row.description,
    soundcloudUrl: row.soundcloudUrl,
    soundcloudTrackId: row.soundcloudTrackId,
    radiocultEventId: row.radiocultEventId,
    updatedAt: row.updatedAt,
    tracks,
  };
}

export type TagCount = TagRef & { shows: number };

/**
 * Les étiquettes portées par au moins un show publié, avec leur nombre de shows : les menus de tri des pages Show
 * (genre et mood pour les DJ sets et les playlists, thème pour les podcasts).
 */
export async function listTags(tx: Tx, { kind, type }: { kind?: TagKind; type?: ShowType } = {}): Promise<TagCount[]> {
  if ((kind !== undefined && !oneOf(tagKind.enumValues, kind)) || (type !== undefined && !oneOf(showType.enumValues, type))) return [];
  const rows = await tx
    .select({ kind: tag.kind, slug: tag.slug, name: tag.name, shows: sql<number>`count(distinct ${show.id})`.mapWith(Number) })
    .from(tag)
    .innerJoin(showTag, eq(showTag.tagId, tag.id))
    .innerJoin(show, and(eq(show.id, showTag.showId), eq(show.status, "published"), type ? eq(show.type, type) : undefined))
    .where(kind ? eq(tag.kind, kind) : undefined)
    .groupBy(tag.id);
  const kinds: readonly string[] = tagKind.enumValues;
  return rows.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || frenchOrder.compare(a.name, b.name));
}
