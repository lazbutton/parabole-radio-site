/**
 * Les shows dans l'admin : la liste (brouillons compris), la fiche à modifier avec ses artistes, ses étiquettes et sa
 * tracklist, l'enregistrement, la suppression. Tout passe sous le rôle de la personne connectée (src/admin/index.ts) :
 * les règles d'accès de la base s'appliquent.
 */
import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { frenchOrder, oneOf, outer, paging, type Paged } from "../read/common.ts";
import { escapeLike, prefixQuery } from "../read/search.ts";
import { artist, contentStatus, media, SEARCH_CONFIG, show, showArtist, showTag, showType, tag, track, type ContentStatus, type ShowType, type TagKind } from "../schema.ts";
import { slugify } from "../slug.ts";
import { freeSlug, versionOf, type NotSaved, type Saved } from "./common.ts";
import { isUuid, type ArtistPick, type ShowValues, type TagPick } from "./input.ts";

// ---------------------------------------------------------------------------------------------------------------
// La liste
// ---------------------------------------------------------------------------------------------------------------

export type AdminShowRow = {
  id: string;
  slug: string;
  title: string;
  type: ShowType;
  status: ContentStatus;
  broadcastAt: Date | null;
  durationSeconds: number | null;
  updatedAt: Date;
  /** Les noms de ses artistes, brouillons compris, dans l'ordre. */
  artists: string[];
  tracks: number;
  /** La piste SoundCloud est renseignée. */
  hasSound: boolean;
  /** Le show vient de l'import Radio Cult. */
  fromRadioCult: boolean;
};

export type AdminShowFilters = {
  /** Recherche : titre, description, artistes, tracklist. */
  q?: string;
  status?: string;
  type?: string;
  /** Identifiant d'une étiquette. */
  tag?: string;
  /** Identifiant d'un artiste. */
  artist?: string;
  /** Ce qui manque à un show déjà diffusé : « tracklist », ou « sound » (la piste SoundCloud). */
  missing?: string;
  /** « recent » (par défaut) : les plus récents d'abord, ceux sans date en tête ; « oldest » : les plus anciens. */
  order?: string;
  limit?: number;
  offset?: number;
  /** L'instant qui sépare le déjà diffusé de l'à venir (maintenant, sauf dans les tests). */
  now?: Date;
};

/** Les noms des artistes d'un show, brouillons compris, dans l'ordre d'affichage. */
export const artistNames = () =>
  sql<string[]>`coalesce((select json_agg(a.name order by sa.position, a.name) from ${showArtist} sa join ${artist} a on a.id = sa.artist_id
    where sa.show_id = ${outer(show.id)}), '[]'::json)`;

/** Un show déjà diffusé sans tracklist : le tableau de bord les compte, la liste les filtre. */
export const lacksTracklist = (now: Date) =>
  sql`(${show.broadcastAt} <= ${now.toISOString()}::timestamptz and not exists (select 1 from ${track} tr where tr.show_id = ${outer(show.id)}))`;

/** Un show déjà diffusé sans piste SoundCloud : le lecteur du site n'a rien à jouer. */
export const lacksSound = (now: Date) => sql`(${show.broadcastAt} <= ${now.toISOString()}::timestamptz and ${show.soundcloudTrackId} is null)`;

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
  return sql`(${show.search} @@ ${tsquery}
    or private.immutable_unaccent(lower(${show.title})) like '%' || ${plain} || '%'
    or exists (select 1 from ${showArtist} sa join ${artist} a on a.id = sa.artist_id
      where sa.show_id = ${outer(show.id)} and (a.search @@ ${nameQuery} or private.immutable_unaccent(lower(a.name)) like '%' || ${plain} || '%'))
    or exists (select 1 from ${track} tr where tr.show_id = ${outer(show.id)} and tr.search @@ ${tsquery}))`;
}

/** Les shows, brouillons compris, filtrés, triés par date de diffusion, par pages de 50. */
export async function listShows(tx: Tx, filters: AdminShowFilters = {}): Promise<Paged<AdminShowRow>> {
  const page = paging(filters, 50);
  const conditions: (SQL | undefined)[] = [];
  if (filters.q) conditions.push(matching(filters.q));
  if (filters.status && oneOf(contentStatus.enumValues, filters.status)) conditions.push(eq(show.status, filters.status));
  if (filters.type && oneOf(showType.enumValues, filters.type)) conditions.push(eq(show.type, filters.type));
  if (isUuid(filters.tag)) conditions.push(sql`exists (select 1 from ${showTag} st where st.show_id = ${outer(show.id)} and st.tag_id = ${filters.tag})`);
  if (isUuid(filters.artist)) conditions.push(sql`exists (select 1 from ${showArtist} sa where sa.show_id = ${outer(show.id)} and sa.artist_id = ${filters.artist})`);
  if (filters.missing === "tracklist") conditions.push(lacksTracklist(filters.now ?? new Date()));
  else if (filters.missing === "sound") conditions.push(lacksSound(filters.now ?? new Date()));
  const where = and(...conditions);
  const order = filters.order === "oldest" ? [sql`${show.broadcastAt} asc nulls last`, asc(show.title)] : [sql`${show.broadcastAt} desc nulls first`, desc(show.updatedAt)];
  const rows = await tx
    .select({
      id: show.id,
      slug: show.slug,
      title: show.title,
      type: show.type,
      status: show.status,
      broadcastAt: show.broadcastAt,
      durationSeconds: show.durationSeconds,
      updatedAt: show.updatedAt,
      artists: artistNames(),
      tracks: sql<number>`(select count(*) from ${track} tr where tr.show_id = ${outer(show.id)})`.mapWith(Number),
      hasSound: sql<boolean>`${show.soundcloudTrackId} is not null`,
      fromRadioCult: sql<boolean>`${show.radiocultEventId} is not null`,
    })
    .from(show)
    .where(where)
    .orderBy(...order)
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await tx.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(show).where(where);
  return { items: rows, total: count?.total ?? 0, ...page };
}

// ---------------------------------------------------------------------------------------------------------------
// La fiche
// ---------------------------------------------------------------------------------------------------------------

export type AdminShowArtist = { id: string; name: string; status: ContentStatus };
export type AdminTag = { id: string; kind: TagKind; name: string };

export type AdminShow = {
  id: string;
  slug: string;
  title: string;
  type: ShowType;
  status: ContentStatus;
  broadcastAt: Date | null;
  durationSeconds: number | null;
  description: string | null;
  soundcloudUrl: string | null;
  soundcloudTrackId: string | null;
  radiocultEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Jeton de version (src/admin/common.ts), à renvoyer avec la fiche. */
  version: string;
  cover: { key: string; alt: string } | null;
  artists: AdminShowArtist[];
  tags: AdminTag[];
  tracks: { artist: string; title: string; startSeconds: number | null; hopperUrl: string | null }[];
};

/** Un show à modifier, brouillon compris. Null s'il n'existe pas. */
export async function getShow(tx: Tx, id: string): Promise<AdminShow | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select({
      id: show.id,
      slug: show.slug,
      title: show.title,
      type: show.type,
      status: show.status,
      broadcastAt: show.broadcastAt,
      durationSeconds: show.durationSeconds,
      description: show.description,
      soundcloudUrl: show.soundcloudUrl,
      soundcloudTrackId: show.soundcloudTrackId,
      radiocultEventId: show.radiocultEventId,
      createdAt: show.createdAt,
      updatedAt: show.updatedAt,
      version: versionOf(show.updatedAt),
      coverId: show.coverId,
    })
    .from(show)
    .where(eq(show.id, id))
    .limit(1);
  if (!row) return null;
  const { coverId, ...fields } = row;
  const [cover] = coverId ? await tx.select({ key: media.key, alt: media.alt }).from(media).where(eq(media.id, coverId)) : [];
  const artists = await tx
    .select({ id: artist.id, name: artist.name, status: artist.status })
    .from(showArtist)
    .innerJoin(artist, eq(artist.id, showArtist.artistId))
    .where(eq(showArtist.showId, id))
    .orderBy(asc(showArtist.position), asc(artist.name));
  const tags = await tx
    .select({ id: tag.id, kind: tag.kind, name: tag.name })
    .from(showTag)
    .innerJoin(tag, eq(tag.id, showTag.tagId))
    .where(eq(showTag.showId, id))
    .orderBy(asc(tag.kind), asc(tag.name));
  const tracks = await tx
    .select({ artist: track.artist, title: track.title, startSeconds: track.startSeconds, hopperUrl: track.hopperUrl })
    .from(track)
    .where(eq(track.showId, id))
    .orderBy(asc(track.position));
  return { ...fields, cover: cover ?? null, artists, tags, tracks };
}

/** Les artistes et les étiquettes à proposer dans la fiche d'un show, dans l'ordre alphabétique français. */
export async function showChoices(tx: Tx): Promise<{ artists: AdminShowArtist[]; tags: AdminTag[] }> {
  const artists = await tx.select({ id: artist.id, name: artist.name, status: artist.status }).from(artist);
  const tags = await tx.select({ id: tag.id, kind: tag.kind, name: tag.name }).from(tag);
  return { artists: artists.sort((a, b) => frenchOrder.compare(a.name, b.name)), tags: tags.sort((a, b) => frenchOrder.compare(a.name, b.name)) };
}

// ---------------------------------------------------------------------------------------------------------------
// L'enregistrement
// ---------------------------------------------------------------------------------------------------------------

/** Le même nom, sans les accents ni les majuscules : « eloise vachon » retrouve « Éloïse Vachon ». */
const sameName = (column: typeof artist.name | typeof tag.name, name: string) => sql`private.immutable_unaccent(lower(${column})) = private.immutable_unaccent(lower(${name}))`;

/** Les artistes choisis, dans l'ordre : un nom nouveau retrouve l'artiste du même nom, ou en crée un, en brouillon. */
async function resolveArtists(tx: Tx, picks: ArtistPick[]): Promise<{ ids: string[]; created: string[] }> {
  const chosen = picks.flatMap((pick) => ("id" in pick ? [pick.id] : []));
  const existing = new Set(chosen.length ? (await tx.select({ id: artist.id }).from(artist).where(inArray(artist.id, chosen))).map((row) => row.id) : []);
  const ids: string[] = [];
  const created: string[] = [];
  for (const pick of picks) {
    let id: string | undefined;
    if ("id" in pick) id = existing.has(pick.id) ? pick.id : undefined;
    else {
      const [same] = await tx.select({ id: artist.id }).from(artist).where(sameName(artist.name, pick.name)).limit(1);
      id = same?.id;
      if (!id) {
        const slug = await freeSlug(tx, artist, slugify(pick.name) || "artiste");
        const [born] = await tx.insert(artist).values({ name: pick.name, slug, role: "guest", status: "draft" }).returning({ id: artist.id });
        id = born!.id;
        created.push(pick.name);
      }
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { ids, created };
}

/** Les étiquettes choisies : une étiquette nouvelle retrouve celle du même type, du même nom ou de la même adresse, ou naît. */
async function resolveTags(tx: Tx, picks: TagPick[]): Promise<{ ids: string[]; created: string[] }> {
  const chosen = picks.flatMap((pick) => ("id" in pick ? [pick.id] : []));
  const existing = new Set(chosen.length ? (await tx.select({ id: tag.id }).from(tag).where(inArray(tag.id, chosen))).map((row) => row.id) : []);
  const ids: string[] = [];
  const created: string[] = [];
  for (const pick of picks) {
    let id: string | undefined;
    if ("id" in pick) id = existing.has(pick.id) ? pick.id : undefined;
    else {
      const slug = slugify(pick.name);
      const [same] = await tx
        .select({ id: tag.id })
        .from(tag)
        .where(and(eq(tag.kind, pick.kind), or(eq(tag.slug, slug), sameName(tag.name, pick.name))))
        .limit(1);
      id = same?.id;
      if (!id) {
        const [born] = await tx.insert(tag).values({ kind: pick.kind, name: pick.name, slug }).returning({ id: tag.id });
        id = born!.id;
        created.push(pick.name);
      }
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { ids, created };
}

export type ShowSave = {
  /** Absent : un show nouveau. */
  id?: string;
  /** Le jeton de version lu à l'ouverture de la fiche. */
  version?: string;
  values: ShowValues;
  /** Publier ou dépublier en même temps. Absent : le statut ne change pas (brouillon pour un show nouveau). */
  status?: ContentStatus;
};

/**
 * Enregistre un show, ses artistes, ses étiquettes et toute sa tracklist, d'un seul coup : la tracklist enregistrée
 * remplace l'ancienne. Les vérifications passent avant la première écriture ; une erreur de la base annule tout.
 */
export async function saveShow(tx: Tx, { id, version, values, status }: ShowSave): Promise<Saved | NotSaved> {
  let finalStatus: ContentStatus = status ?? "draft";
  if (id !== undefined) {
    const gone: NotSaved = { ok: false, errors: { form: "Ce show n'existe plus : il a peut-être été supprimé." } };
    if (!isUuid(id)) return gone;
    const [current] = await tx.select({ version: versionOf(show.updatedAt), status: show.status }).from(show).where(eq(show.id, id)).for("update");
    if (!current) return gone;
    if (version !== undefined && version !== current.version)
      return {
        ok: false,
        version: current.version,
        errors: { form: "Quelqu'un a enregistré ce show pendant que tu le modifiais. Enregistre de nouveau pour remplacer sa version par la tienne." },
      };
    finalStatus = status ?? current.status;
  }
  if (finalStatus === "published" && !values.broadcastAt) return { ok: false, errors: { broadcastAt: "Il faut une date de diffusion pour publier." } };
  let slug = values.slug;
  const [clash] = await tx
    .select({ title: show.title })
    .from(show)
    .where(and(eq(show.slug, slug), id ? ne(show.id, id) : undefined))
    .limit(1);
  if (clash) {
    if (!values.slugFromTitle) return { ok: false, errors: { slug: `Cette adresse sert déjà au show « ${clash.title} ».` } };
    slug = await freeSlug(tx, show, slug, id);
  }

  const fields = {
    slug,
    title: values.title,
    type: values.type,
    broadcastAt: values.broadcastAt,
    durationSeconds: values.durationSeconds,
    description: values.description,
    soundcloudUrl: values.soundcloudUrl,
    soundcloudTrackId: values.soundcloudTrackId,
    ...(status ? { status } : {}),
  };
  let showId: string;
  if (id) {
    await tx.update(show).set(fields).where(eq(show.id, id));
    showId = id;
  } else {
    const [created] = await tx.insert(show).values(fields).returning({ id: show.id });
    showId = created!.id;
  }

  const artists = await resolveArtists(tx, values.artists);
  await tx.delete(showArtist).where(eq(showArtist.showId, showId));
  if (artists.ids.length) await tx.insert(showArtist).values(artists.ids.map((artistId, position) => ({ showId, artistId, position })));

  const tags = await resolveTags(tx, values.tags);
  await tx.delete(showTag).where(eq(showTag.showId, showId));
  if (tags.ids.length) await tx.insert(showTag).values(tags.ids.map((tagId) => ({ showId, tagId })));

  await tx.delete(track).where(eq(track.showId, showId));
  if (values.tracks.length) await tx.insert(track).values(values.tracks.map((line, index) => ({ showId, position: index + 1, ...line })));

  return { ok: true, id: showId, slug, newArtists: artists.created, newTags: tags.created };
}

/** Supprime un show, avec sa tracklist et ses liens (pas sa pochette, qui reste dans les fichiers). Rend son titre. */
export async function deleteShow(tx: Tx, id: string): Promise<{ title: string } | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(show).where(eq(show.id, id)).returning({ title: show.title });
  return removed ?? null;
}
