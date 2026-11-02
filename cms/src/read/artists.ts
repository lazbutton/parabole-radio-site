/**
 * Les artistes pour le site : résidents et invités en index A–Z, filtrés par activité (podcast, playlist, DJ), et la
 * page d'un artiste avec ses shows.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { artist, artistRole, artistTag, event, eventArtist, show, showArtist, showTag, tag, type ArtistLink, type ArtistRole } from "../schema.ts";
import { isSlug } from "../slug.ts";
import { coveredTags, frenchOrder, mediaJson, oneOf, outer, toImage, type Image, type MediaRow, type TagRef } from "./common.ts";
import { eventCardFields, toEventCard, type EventCard } from "./events.ts";
import { hasArtist, showCardFields, toShowCard, type ShowCard } from "./shows.ts";

/** Un portrait de l'index : le nom, le rôle, la photo, et les étiquettes de l'artiste (ce qu'il fait). */
export type ArtistCard = { slug: string; name: string; role: ArtistRole; photo: Image | null; tags: TagRef[] };

/** L'index A–Z : une lettre par groupe, « # » pour les noms qui commencent par un chiffre ou un signe. */
export type ArtistIndex = { total: number; groups: { letter: string; artists: ArtistCard[] }[] };

export type ArtistDetail = ArtistCard & {
  bio: string | null;
  links: ArtistLink[];
  updatedAt: Date;
  /** Les étiquettes de ses shows, des plus fréquentes aux plus rares. */
  showTags: TagRef[];
  /** Ses shows publiés, du plus récent au plus ancien. */
  shows: ShowCard[];
  /** Ses événements publiés, du plus récent au plus ancien. */
  events: EventCard[];
};

/** La lettre de l'index : « Éloïse » sous E, « Œil » sous O, « 404 Crew » sous #. */
export function indexLetter(name: string): string {
  const first = name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[œŒ]/u, "O").replace(/[æÆ]/u, "A").match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "";
  return /^[A-Z]$/.test(first) ? first : "#";
}

const artistTags = sql<TagRef[]>`coalesce((
    select json_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.name)
    from ${artistTag} ag join ${tag} t on t.id = ag.tag_id
    where ag.artist_id = ${outer(artist.id)}), '[]'::json)`;

/** Les colonnes d'un portrait, pour toute requête sur « artist » (index, recherche). */
export const artistCardFields = { slug: artist.slug, name: artist.name, role: artist.role, photo: mediaJson(artist.photoId), tags: artistTags };

type ArtistCardRow = Omit<ArtistCard, "photo"> & { photo: MediaRow | null };

export const toArtistCard = (base: string, row: ArtistCardRow): ArtistCard => ({ ...row, photo: toImage(base, row.photo) });

export type ArtistFilters = {
  role?: ArtistRole;
  /** L'adresse d'une étiquette (« dj ») : celle-ci, ou une étiquette de son groupe. */
  tag?: string;
};

/** Les artistes publiés, par rôle et par étiquette, rangés par lettre dans l'ordre alphabétique français (# à la fin). */
export async function listArtists(tx: Tx, base: string, { role, tag: tagSlug }: ArtistFilters = {}): Promise<ArtistIndex> {
  if (role !== undefined && !oneOf(artistRole.enumValues, role)) return { total: 0, groups: [] };
  if (tagSlug !== undefined && !isSlug(tagSlug)) return { total: 0, groups: [] };
  const rows = await tx
    .select(artistCardFields)
    .from(artist)
    .where(
      and(
        eq(artist.status, "published"),
        role ? eq(artist.role, role) : undefined,
        tagSlug ? sql`exists (select 1 from ${artistTag} ag where ag.artist_id = ${outer(artist.id)} and ag.tag_id in ${coveredTags(tagSlug)})` : undefined,
      ),
    );
  const cards = rows.map((row) => toArtistCard(base, row)).sort((a, b) => frenchOrder.compare(a.name, b.name));
  const groups = new Map<string, ArtistCard[]>();
  for (const card of cards) {
    const letter = indexLetter(card.name);
    groups.set(letter, [...(groups.get(letter) ?? []), card]);
  }
  return {
    total: cards.length,
    groups: [...groups]
      .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
      .map(([letter, artists]) => ({ letter, artists })),
  };
}

/** Un artiste publié, avec ses shows et ses événements. Null s'il n'existe pas ou n'est pas publié. */
export async function getArtist(tx: Tx, base: string, slug: string): Promise<ArtistDetail | null> {
  if (!isSlug(slug)) return null;
  const [row] = await tx
    .select({ id: artist.id, ...artistCardFields, bio: artist.bio, links: artist.links, updatedAt: artist.updatedAt })
    .from(artist)
    .where(and(eq(artist.slug, slug), eq(artist.status, "published")))
    .limit(1);
  if (!row) return null;
  const shows = await tx
    .select(showCardFields)
    .from(show)
    .where(and(eq(show.status, "published"), hasArtist({ id: row.id })))
    .orderBy(desc(show.broadcastAt), asc(show.title));
  const showTags = await tx
    .select({ slug: tag.slug, name: tag.name })
    .from(tag)
    .innerJoin(showTag, eq(showTag.tagId, tag.id))
    .innerJoin(show, and(eq(show.id, showTag.showId), eq(show.status, "published")))
    .innerJoin(showArtist, and(eq(showArtist.showId, show.id), eq(showArtist.artistId, row.id)))
    .groupBy(tag.id)
    .orderBy(desc(sql`count(*)`), asc(tag.name));
  const events = await tx
    .select(eventCardFields)
    .from(event)
    .where(and(eq(event.status, "published"), sql`exists (select 1 from ${eventArtist} ea where ea.event_id = ${outer(event.id)} and ea.artist_id = ${row.id})`))
    .orderBy(desc(event.startsAt), asc(event.title));
  return {
    ...toArtistCard(base, { slug: row.slug, name: row.name, role: row.role, photo: row.photo, tags: row.tags }),
    bio: row.bio,
    links: row.links,
    updatedAt: row.updatedAt,
    showTags,
    shows: shows.map((show) => toShowCard(base, show)),
    events: events.map((event) => toEventCard(base, event)),
  };
}
