/**
 * Les événements dans l'admin : la liste (brouillons compris), la fiche à modifier avec sa catégorie, ses artistes et
 * sa galerie, l'enregistrement, la suppression ; et la galerie, qui change sur place, photo par photo, comme le visuel
 * (src/admin/media.ts). Tout passe sous le rôle de la personne connectée (src/admin/index.ts) : les règles d'accès de
 * la base s'appliquent.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { eventIsUpcoming } from "../read/events.ts";
import { coveredTagIds, frenchOrder, oneOf, outer, paging, type Paged } from "../read/common.ts";
import { escapeLike, prefixQuery } from "../read/search.ts";
import { artist, contentStatus, event, eventArtist, eventPhoto, eventTag, media, SEARCH_CONFIG, tag, type ContentStatus } from "../schema.ts";
import { freeSlug, versionOf, type NotSaved, type Saved } from "./common.ts";
import { isUuid, type EventValues } from "./input.ts";
import { getMedia, mediaColumns, type AdminMedia } from "./media.ts";
import { resolveArtists, resolveTags, type AdminShowArtist, type AdminTag } from "./shows.ts";
import { tagChoices, type AdminFacetChoice, type AdminTagChoice } from "./tags.ts";

// ---------------------------------------------------------------------------------------------------------------
// La liste
// ---------------------------------------------------------------------------------------------------------------

export type AdminEventRow = {
  id: string;
  slug: string;
  title: string;
  status: ContentStatus;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  updatedAt: Date;
  /** Pas encore fini (la règle du site, src/read/events.ts). */
  upcoming: boolean;
  /** Les noms de ses étiquettes (sa catégorie), dans l'ordre alphabétique. */
  categories: string[];
  /** Les noms de ses artistes, brouillons compris, dans l'ordre. */
  artists: string[];
  hasVisual: boolean;
  photos: number;
};

export type AdminEventFilters = {
  /** Recherche : titre, lieu, description, artistes. */
  q?: string;
  status?: string;
  /** « upcoming » : pas encore fini ; « past » : fini. */
  period?: string;
  /** Identifiant d'une étiquette : celle-ci, ou une étiquette de son groupe. */
  tag?: string;
  limit?: number;
  offset?: number;
  /** L'instant qui sépare l'à venir du passé (maintenant, sauf dans les tests). */
  now?: Date;
};

/** La recherche de l'admin : comme celle du site (src/read/search.ts), brouillons compris. */
function matching(input: string): SQL | undefined {
  const query = input.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 200);
  const words = prefixQuery(query);
  if (!words) return undefined;
  const config = sql.raw(`'${SEARCH_CONFIG}'::regconfig`);
  const tsquery = sql`to_tsquery(${config}, ${words})`;
  // Le nom d'un artiste (poids A de son vecteur), pas sa bio.
  const nameQuery = sql`to_tsquery(${config}, ${prefixQuery(query, "A")})`;
  const plain = sql`private.immutable_unaccent(lower(${escapeLike(query)}))`;
  return sql`(${event.search} @@ ${tsquery}
    or private.immutable_unaccent(lower(${event.title})) like '%' || ${plain} || '%'
    or exists (select 1 from ${eventArtist} ea join ${artist} a on a.id = ea.artist_id
      where ea.event_id = ${outer(event.id)} and (a.search @@ ${nameQuery} or private.immutable_unaccent(lower(a.name)) like '%' || ${plain} || '%')))`;
}

/**
 * Les événements, brouillons compris, filtrés, par pages de 50 : ceux à venir d'abord, du plus proche au plus
 * lointain, puis les passés, du plus récent au plus ancien.
 */
export async function listEvents(tx: Tx, filters: AdminEventFilters = {}): Promise<Paged<AdminEventRow>> {
  const page = paging(filters, 50);
  const upcoming = eventIsUpcoming(filters.now ?? new Date());
  const conditions: (SQL | undefined)[] = [];
  if (filters.q) conditions.push(matching(filters.q));
  if (filters.status && oneOf(contentStatus.enumValues, filters.status)) conditions.push(eq(event.status, filters.status));
  if (filters.period === "upcoming") conditions.push(upcoming);
  else if (filters.period === "past") conditions.push(sql`not ${upcoming}`);
  if (isUuid(filters.tag)) conditions.push(sql`exists (select 1 from ${eventTag} et where et.event_id = ${outer(event.id)} and et.tag_id in ${coveredTagIds(filters.tag)})`);
  const where = and(...conditions);
  const rows = await tx
    .select({
      id: event.id,
      slug: event.slug,
      title: event.title,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venue: event.venue,
      updatedAt: event.updatedAt,
      upcoming: sql<boolean>`${upcoming}`,
      categories: sql<string[]>`coalesce((select json_agg(t.name) from ${eventTag} et join ${tag} t on t.id = et.tag_id
        where et.event_id = ${outer(event.id)}), '[]'::json)`,
      artists: sql<string[]>`coalesce((select json_agg(a.name order by ea.position, a.name) from ${eventArtist} ea join ${artist} a on a.id = ea.artist_id
        where ea.event_id = ${outer(event.id)}), '[]'::json)`,
      hasVisual: sql<boolean>`${event.visualId} is not null`,
      photos: sql<number>`(select count(*) from ${eventPhoto} p where p.event_id = ${outer(event.id)})`.mapWith(Number),
    })
    .from(event)
    .where(where)
    .orderBy(sql`${upcoming} desc`, sql`case when ${upcoming} then ${event.startsAt} end asc`, desc(event.startsAt), asc(event.title))
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await tx.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(event).where(where);
  // l'ordre alphabétique français : « Événement spécial » avant « Fête »
  return { items: rows.map((row) => ({ ...row, categories: row.categories.sort(frenchOrder.compare) })), total: count?.total ?? 0, ...page };
}

// ---------------------------------------------------------------------------------------------------------------
// La fiche
// ---------------------------------------------------------------------------------------------------------------

/** Une photo de la galerie : l'image, et sa légende. */
export type AdminEventPhoto = { media: AdminMedia; caption: string | null };

export type AdminEvent = {
  id: string;
  slug: string;
  title: string;
  status: ContentStatus;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  address: string | null;
  description: string | null;
  ticketUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Jeton de version (src/admin/common.ts), à renvoyer avec la fiche. */
  version: string;
  visual: AdminMedia | null;
  artists: AdminShowArtist[];
  tags: AdminTag[];
  /** La galerie, dans l'ordre de défilement. */
  photos: AdminEventPhoto[];
};

/** La galerie d'un événement, dans l'ordre. */
async function photosOf(tx: Tx, id: string): Promise<AdminEventPhoto[]> {
  const rows = await tx
    .select({ ...mediaColumns, caption: eventPhoto.caption })
    .from(eventPhoto)
    .innerJoin(media, eq(media.id, eventPhoto.mediaId))
    .where(eq(eventPhoto.eventId, id))
    .orderBy(asc(eventPhoto.position), asc(media.key));
  return rows.map(({ caption, ...file }) => ({ media: file, caption }));
}

/** Un événement à modifier, brouillon compris. Null s'il n'existe pas. */
export async function getEvent(tx: Tx, id: string): Promise<AdminEvent | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select({
      id: event.id,
      slug: event.slug,
      title: event.title,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venue: event.venue,
      address: event.address,
      description: event.description,
      ticketUrl: event.ticketUrl,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      version: versionOf(event.updatedAt),
      visualId: event.visualId,
    })
    .from(event)
    .where(eq(event.id, id))
    .limit(1);
  if (!row) return null;
  const { visualId, ...fields } = row;
  const visual = await getMedia(tx, visualId);
  const artists = await tx
    .select({ id: artist.id, name: artist.name, status: artist.status })
    .from(eventArtist)
    .innerJoin(artist, eq(artist.id, eventArtist.artistId))
    .where(eq(eventArtist.eventId, id))
    .orderBy(asc(eventArtist.position), asc(artist.name));
  const tags = (
    await tx
      .select({ id: tag.id, name: tag.name })
      .from(eventTag)
      .innerJoin(tag, eq(tag.id, eventTag.tagId))
      .where(eq(eventTag.eventId, id))
  ).sort((a, b) => frenchOrder.compare(a.name, b.name));
  return { ...fields, visual, artists, tags, photos: await photosOf(tx, id) };
}

/**
 * Ce que propose la fiche d'un événement : les artistes, dans l'ordre alphabétique français ; les étiquettes du filtre
 * des événements (Catégorie), avec leurs places, puis celles à classer ; et ce filtre, pour les montrer à la souris.
 */
export async function eventChoices(tx: Tx): Promise<{ artists: AdminShowArtist[]; tags: AdminTagChoice[]; facets: AdminFacetChoice[] }> {
  const artists = await tx.select({ id: artist.id, name: artist.name, status: artist.status }).from(artist);
  const { tags, facets } = await tagChoices(tx, "event", { unplaced: true });
  return { artists: artists.sort((a, b) => frenchOrder.compare(a.name, b.name)), tags, facets };
}

// ---------------------------------------------------------------------------------------------------------------
// L'enregistrement
// ---------------------------------------------------------------------------------------------------------------

export type EventSave = {
  /** Absent : un événement nouveau. */
  id?: string;
  /** Le jeton de version lu à l'ouverture de la fiche. */
  version?: string;
  values: EventValues;
  /** Publier ou dépublier en même temps. Absent : le statut ne change pas (brouillon pour un événement nouveau). */
  status?: ContentStatus;
};

/**
 * Enregistre un événement, ses artistes et sa catégorie, d'un seul coup. Sa galerie et son visuel changent à part.
 * Publier, ou enregistrer un événement publié, exige une catégorie. Les vérifications passent avant la première
 * écriture ; une erreur de la base annule tout.
 */
export async function saveEvent(tx: Tx, { id, version, values, status }: EventSave): Promise<Saved | NotSaved> {
  let finalStatus: ContentStatus = status ?? "draft";
  if (id !== undefined) {
    const gone: NotSaved = { ok: false, errors: { form: "Cet événement n'existe plus : il a peut-être été supprimé." } };
    if (!isUuid(id)) return gone;
    const [current] = await tx.select({ version: versionOf(event.updatedAt), status: event.status }).from(event).where(eq(event.id, id)).for("update");
    if (!current) return gone;
    if (version !== undefined && version !== current.version)
      return {
        ok: false,
        version: current.version,
        errors: { form: "Quelqu'un a enregistré cet événement pendant que tu le modifiais. Enregistre de nouveau pour remplacer sa version par la tienne." },
      };
    finalStatus = status ?? current.status;
  }
  if (finalStatus === "published" && !values.tags.length) return { ok: false, errors: { tags: "Choisis sa catégorie pour publier." } };
  let slug = values.slug;
  const [clash] = await tx
    .select({ title: event.title })
    .from(event)
    .where(and(eq(event.slug, slug), id ? ne(event.id, id) : undefined))
    .limit(1);
  if (clash) {
    if (!values.slugFromTitle) return { ok: false, errors: { slug: `Cette adresse sert déjà à l'événement « ${clash.title} ».` } };
    slug = await freeSlug(tx, event, slug, id);
  }

  const fields = {
    slug,
    title: values.title,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    venue: values.venue,
    address: values.address,
    description: values.description,
    ticketUrl: values.ticketUrl,
    ...(status ? { status } : {}),
  };
  let eventId: string;
  if (id) {
    await tx.update(event).set(fields).where(eq(event.id, id));
    eventId = id;
  } else {
    const [created] = await tx.insert(event).values(fields).returning({ id: event.id });
    eventId = created!.id;
  }

  const artists = await resolveArtists(tx, values.artists);
  await tx.delete(eventArtist).where(eq(eventArtist.eventId, eventId));
  if (artists.ids.length) await tx.insert(eventArtist).values(artists.ids.map((artistId, position) => ({ eventId, artistId, position })));

  const tags = await resolveTags(tx, values.tags);
  await tx.delete(eventTag).where(eq(eventTag.eventId, eventId));
  if (tags.ids.length) await tx.insert(eventTag).values(tags.ids.map((tagId) => ({ eventId, tagId })));

  return { ok: true, id: eventId, slug, newArtists: artists.created, newTags: tags.created };
}

/**
 * Supprime un événement, avec ses liens et sa galerie. Rend son titre, et ses images (le visuel, les photos), à
 * retirer si elles ne servent plus (releaseMedia).
 */
export async function deleteEvent(tx: Tx, id: string): Promise<{ title: string; mediaIds: string[] } | null> {
  if (!isUuid(id)) return null;
  const photos = await tx.select({ mediaId: eventPhoto.mediaId }).from(eventPhoto).where(eq(eventPhoto.eventId, id));
  const [removed] = await tx.delete(event).where(eq(event.id, id)).returning({ title: event.title, visualId: event.visualId });
  if (!removed) return null;
  return { title: removed.title, mediaIds: [removed.visualId, ...photos.map((photo) => photo.mediaId)].filter((mediaId) => mediaId !== null) };
}

// ---------------------------------------------------------------------------------------------------------------
// La galerie
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ce que rend un changement de la galerie : la galerie à jour, et les images qui en sont sorties, à retirer si elles
 * ne servent plus (releaseMedia).
 */
export type GalleryChanged = { ok: true; photos: AdminEventPhoto[]; released: string[] };

const eventGone: NotSaved = { ok: false, errors: { form: "Cet événement n'existe plus : il a peut-être été supprimé." } };

/** L'événement existe, et on le verrouille le temps du changement : deux changements de la galerie ne se croisent pas. */
async function lockEvent(tx: Tx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [row] = await tx.select({ id: event.id }).from(event).where(eq(event.id, id)).for("update");
  return Boolean(row);
}

/** Ajoute des images envoyées à la fin de la galerie, avec leur légende. Une image déjà dans la galerie n'y entre pas deux fois. */
export async function addEventPhotos(tx: Tx, id: string, photos: { mediaId: string; caption: string | null }[]): Promise<GalleryChanged | NotSaved> {
  if (!(await lockEvent(tx, id))) return eventGone;
  const wanted = photos.filter((photo, index) => isUuid(photo.mediaId) && photos.findIndex((other) => other.mediaId === photo.mediaId) === index);
  const known = wanted.length ? new Set((await tx.select({ id: media.id }).from(media).where(inArray(media.id, wanted.map((photo) => photo.mediaId)))).map((row) => row.id)) : new Set();
  const [last] = await tx.select({ position: sql<number>`coalesce(max(${eventPhoto.position}), -1)`.mapWith(Number) }).from(eventPhoto).where(eq(eventPhoto.eventId, id));
  const fresh = wanted.filter((photo) => known.has(photo.mediaId));
  if (fresh.length < wanted.length) return { ok: false, errors: { image: "Une image n'existe plus : envoie-la de nouveau." } };
  if (fresh.length)
    await tx
      .insert(eventPhoto)
      .values(fresh.map((photo, index) => ({ eventId: id, mediaId: photo.mediaId, caption: photo.caption, position: (last?.position ?? -1) + 1 + index })))
      .onConflictDoNothing();
  return { ok: true, photos: await photosOf(tx, id), released: [] };
}

/** Range la galerie dans cet ordre (les identifiants des images). Celles qui manquent à la liste gardent leur place relative, à la fin. */
export async function orderEventPhotos(tx: Tx, id: string, mediaIds: string[]): Promise<GalleryChanged | NotSaved> {
  if (!(await lockEvent(tx, id))) return eventGone;
  const current = (await photosOf(tx, id)).map((photo) => photo.media.id);
  const order = [...mediaIds.filter((mediaId, index) => current.includes(mediaId) && mediaIds.indexOf(mediaId) === index), ...current.filter((mediaId) => !mediaIds.includes(mediaId))];
  for (const [position, mediaId] of order.entries())
    await tx
      .update(eventPhoto)
      .set({ position })
      .where(and(eq(eventPhoto.eventId, id), eq(eventPhoto.mediaId, mediaId)));
  return { ok: true, photos: await photosOf(tx, id), released: [] };
}

/** Change la légende d'une photo de la galerie. */
export async function captionEventPhoto(tx: Tx, id: string, mediaId: string, caption: string | null): Promise<GalleryChanged | NotSaved> {
  if (!(await lockEvent(tx, id))) return eventGone;
  if (!isUuid(mediaId)) return { ok: false, errors: { image: "Cette photo n'est plus dans la galerie." } };
  const [updated] = await tx
    .update(eventPhoto)
    .set({ caption })
    .where(and(eq(eventPhoto.eventId, id), eq(eventPhoto.mediaId, mediaId)))
    .returning({ mediaId: eventPhoto.mediaId });
  if (!updated) return { ok: false, errors: { image: "Cette photo n'est plus dans la galerie." } };
  return { ok: true, photos: await photosOf(tx, id), released: [] };
}

/** Retire une photo de la galerie. Rend son image, à retirer si elle ne sert plus. */
export async function removeEventPhoto(tx: Tx, id: string, mediaId: string): Promise<GalleryChanged | NotSaved> {
  if (!(await lockEvent(tx, id))) return eventGone;
  const removed = isUuid(mediaId)
    ? await tx
        .delete(eventPhoto)
        .where(and(eq(eventPhoto.eventId, id), eq(eventPhoto.mediaId, mediaId)))
        .returning({ mediaId: eventPhoto.mediaId })
    : [];
  return { ok: true, photos: await photosOf(tx, id), released: removed.map((row) => row.mediaId) };
}
