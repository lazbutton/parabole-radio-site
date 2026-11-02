/**
 * Les shows pour le site : la liste filtrée (type, étiquettes, mood, artiste, période), un show avec sa tracklist et
 * ses artistes. Les menus des filtres sont dans facets.ts.
 */
import { and, asc, desc, eq, gt, gte, isNotNull, lt, lte, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { ENERGY } from "../labels.ts";
import { artist, show, showArtist, showTag, showType, tag, track, type ShowType } from "../schema.ts";
import { isSlug } from "../slug.ts";
import { coveredTags, emptyPage, mediaJson, oneOf, outer, paging, toImage, type ArtistRef, type Image, type MediaRow, type Paged, type TagRef } from "./common.ts";

/** Une vignette de show : ce que montrent les grilles et les rangées (titre, artistes, date, étiquettes). */
export type ShowCard = {
  slug: string;
  title: string;
  type: ShowType;
  broadcastAt: Date;
  durationSeconds: number | null;
  /** Le mood, de 1 (calme) à 5 (énergique) ; null s'il n'est pas renseigné. */
  energy: number | null;
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
  /**
   * Des adresses d'étiquettes, toutes exigées (« club » et « afrique-moyen-orient ») : une étiquette de groupe vaut
   * pour tout son groupe (cms/src/read/common.ts, coveredTags).
   */
  tags?: string[];
  /** Le mood, de 1 (calme) à 5 (énergique) : les shows dans cette fourchette, bornes comprises. */
  energy?: { min?: number; max?: number };
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
    select json_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.name)
    from ${showTag} st join ${tag} t on t.id = st.tag_id
    where st.show_id = ${outer(show.id)}), '[]'::json)`;

/** Les colonnes d'une vignette, pour toute requête sur « show » (listes, page d'artiste, recherche). */
export const showCardFields = {
  slug: show.slug,
  title: show.title,
  type: show.type,
  broadcastAt: show.broadcastAt,
  durationSeconds: show.durationSeconds,
  energy: show.energy,
  cover: mediaJson(show.coverId),
  artists: showArtists,
  tags: showTags,
};

type ShowCardRow = {
  slug: string;
  title: string;
  type: ShowType;
  broadcastAt: Date | null;
  durationSeconds: number | null;
  energy: number | null;
  cover: MediaRow | null;
  artists: ArtistRef[];
  tags: TagRef[];
};

export const toShowCard = (base: string, row: ShowCardRow): ShowCard => ({
  slug: row.slug,
  title: row.title,
  type: row.type,
  // Un show publié a toujours une date (contrainte show_published_has_date).
  broadcastAt: row.broadcastAt as Date,
  durationSeconds: row.durationSeconds,
  energy: row.energy,
  cover: toImage(base, row.cover),
  artists: row.artists,
  tags: row.tags,
});

/** Un show qui porte cette étiquette, ou une étiquette de son groupe. */
const hasTag = (slug: string) => sql`exists (select 1 from ${showTag} st where st.show_id = ${outer(show.id)} and st.tag_id in ${coveredTags(slug)})`;
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
  for (const slug of filters.tags ?? []) {
    if (!isSlug(slug)) return null;
    conditions.push(hasTag(slug));
  }
  if (filters.energy) {
    const { min = ENERGY.min, max = ENERGY.max } = filters.energy;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return null;
    if (min > ENERGY.min) conditions.push(gte(show.energy, min));
    if (max < ENERGY.max) conditions.push(lte(show.energy, max));
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

/**
 * Une diffusion : un show publié de durée connue, le temps qu'il passe à l'antenne, et les slugs de ses artistes
 * publiés. De quoi dire, dans le navigateur, qui est à l'antenne en ce moment (la grille des résidents).
 */
export type Airing = { slug: string; title: string; startsAt: Date; endsAt: Date; artists: string[] };

const showArtistSlugs = sql<string[]>`coalesce((
    select json_agg(a.slug order by sa.position, a.name)
    from ${showArtist} sa join ${artist} a on a.id = sa.artist_id
    where sa.show_id = ${outer(show.id)} and a.status = 'published'), '[]'::json)`;

/** Les diffusions qui croisent l'intervalle [from, to], de la plus tôt à la plus tard. Un intervalle à l'envers : rien. */
export async function listAirings(tx: Tx, { from, to }: { from: Date; to: Date }): Promise<Airing[]> {
  const valid = (date: unknown): date is Date => date instanceof Date && !Number.isNaN(date.getTime());
  if (!valid(from) || !valid(to) || from > to) return [];
  const rows = await tx
    .select({ slug: show.slug, title: show.title, startsAt: show.broadcastAt, durationSeconds: show.durationSeconds, artists: showArtistSlugs })
    .from(show)
    .where(
      and(
        eq(show.status, "published"),
        isNotNull(show.durationSeconds),
        lt(show.broadcastAt, to),
        sql`${show.broadcastAt} + make_interval(secs => ${show.durationSeconds}) > ${from.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(show.broadcastAt), asc(show.title));
  return rows.map(({ slug, title, startsAt, durationSeconds, artists }) => {
    // Un show publié a toujours une date (contrainte show_published_has_date) ; la durée est filtrée plus haut.
    const start = startsAt as Date;
    return { slug, title, startsAt: start, endsAt: new Date(start.getTime() + (durationSeconds as number) * 1000), artists };
  });
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
