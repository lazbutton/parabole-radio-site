/**
 * Les événements pour le site : à venir et passés, par catégorie (les étiquettes du filtre Catégorie : Fête,
 * Rencontre/Talk…), et la page d'un événement avec sa galerie.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { artist, event, eventArtist, eventPhoto, eventTag, media, tag } from "../schema.ts";
import { isSlug } from "../slug.ts";
import { coveredTags, emptyPage, mediaJson, oneOf, outer, paging, startOfParisDay, toImage, type ArtistRef, type Image, type MediaRow, type Paged, type TagRef } from "./common.ts";

export type EventCard = {
  slug: string;
  title: string;
  /** Ses étiquettes (sa catégorie), à montrer sous l'événement. */
  tags: TagRef[];
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  visual: Image | null;
  artists: ArtistRef[];
};

export type EventPhoto = Image & { caption: string | null };

export type EventDetail = EventCard & {
  description: string | null;
  address: string | null;
  ticketUrl: string | null;
  updatedAt: Date;
  /** La galerie, dans l'ordre de défilement. */
  photos: EventPhoto[];
};

export type EventFilters = {
  /** À venir : pas encore fini. Passé : fini. */
  period: "upcoming" | "past";
  /** L'adresse d'une étiquette (« fete ») : celle-ci, ou une étiquette de son groupe. */
  tag?: string;
  /** L'instant de référence (maintenant par défaut). */
  now?: Date;
  limit?: number;
  offset?: number;
};

const eventArtists = sql<ArtistRef[]>`coalesce((
    select json_agg(json_build_object('slug', a.slug, 'name', a.name, 'role', a.role) order by ea.position, a.name)
    from ${eventArtist} ea join ${artist} a on a.id = ea.artist_id
    where ea.event_id = ${outer(event.id)} and a.status = 'published'), '[]'::json)`;

const eventTags = sql<TagRef[]>`coalesce((
    select json_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.name)
    from ${eventTag} et join ${tag} t on t.id = et.tag_id
    where et.event_id = ${outer(event.id)}), '[]'::json)`;

/** Les colonnes d'une vignette, pour toute requête sur « event » (listes, page d'artiste, recherche). */
export const eventCardFields = {
  slug: event.slug,
  title: event.title,
  tags: eventTags,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  venue: event.venue,
  visual: mediaJson(event.visualId),
  artists: eventArtists,
};

type EventCardRow = Omit<EventCard, "visual"> & { visual: MediaRow | null };

export const toEventCard = (base: string, row: EventCardRow): EventCard => ({ ...row, visual: toImage(base, row.visual) });

/**
 * Pas encore fini à cet instant. Sans heure de fin, un événement reste à venir jusqu'à la fin de son jour (heure de
 * Paris) : la soirée de ce soir est encore « à venir » une fois commencée.
 */
export function eventIsUpcoming(now: Date): SQL {
  const today = startOfParisDay(now);
  return sql`(case when ${event.endsAt} is not null then ${event.endsAt} >= ${now.toISOString()}::timestamptz
    else ${event.startsAt} >= ${today.toISOString()}::timestamptz end)`;
}

/** Les événements publiés à venir (du plus proche au plus lointain) ou passés (du plus récent au plus ancien). */
export async function listEvents(tx: Tx, base: string, filters: EventFilters): Promise<Paged<EventCard>> {
  const page = paging(filters);
  if (!oneOf(["upcoming", "past"] as const, filters.period)) return emptyPage(page);
  if (filters.tag !== undefined && !isSlug(filters.tag)) return emptyPage(page);
  const upcoming = eventIsUpcoming(filters.now ?? new Date());
  const where = and(
    eq(event.status, "published"),
    filters.period === "upcoming" ? upcoming : sql`not ${upcoming}`,
    filters.tag ? sql`exists (select 1 from ${eventTag} et where et.event_id = ${outer(event.id)} and et.tag_id in ${coveredTags(filters.tag)})` : undefined,
  );
  const order = filters.period === "upcoming" ? asc(event.startsAt) : desc(event.startsAt);
  const rows = await tx.select(eventCardFields).from(event).where(where).orderBy(order, asc(event.title)).limit(page.limit).offset(page.offset);
  const [count] = await tx.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(event).where(where);
  return { items: rows.map((row) => toEventCard(base, row)), total: count?.total ?? 0, ...page };
}

/** Un événement publié, avec ses artistes et sa galerie. Null s'il n'existe pas ou n'est pas publié. */
export async function getEvent(tx: Tx, base: string, slug: string): Promise<EventDetail | null> {
  if (!isSlug(slug)) return null;
  const [row] = await tx
    .select({ id: event.id, ...eventCardFields, description: event.description, address: event.address, ticketUrl: event.ticketUrl, updatedAt: event.updatedAt })
    .from(event)
    .where(and(eq(event.slug, slug), eq(event.status, "published")))
    .limit(1);
  if (!row) return null;
  const photos = await tx
    .select({ key: media.key, width: media.width, height: media.height, alt: media.alt, credit: media.credit, variants: media.variants, caption: eventPhoto.caption })
    .from(eventPhoto)
    .innerJoin(media, eq(media.id, eventPhoto.mediaId))
    .where(eq(eventPhoto.eventId, row.id))
    .orderBy(asc(eventPhoto.position), asc(media.key));
  const { id: _id, description, address, ticketUrl, updatedAt, ...card } = row;
  return {
    ...toEventCard(base, card),
    description,
    address,
    ticketUrl,
    updatedAt,
    photos: photos.map(({ caption, ...file }) => ({ ...(toImage(base, file) as Image), caption })),
  };
}
