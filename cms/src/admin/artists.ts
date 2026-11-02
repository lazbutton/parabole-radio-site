/**
 * Les artistes dans l'admin : l'index A–Z (brouillons compris), la fiche à modifier avec ses shows et ses étiquettes,
 * l'enregistrement, la suppression. Sous le rôle de la personne connectée (src/admin/index.ts).
 */
import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { indexLetter } from "../read/artists.ts";
import { coveredTagIds, frenchOrder, oneOf, outer } from "../read/common.ts";
import { escapeLike, prefixQuery } from "../read/search.ts";
import { artist, artistRole, artistTag, contentStatus, eventArtist, SEARCH_CONFIG, show, showArtist, tag, type ArtistLink, type ArtistRole, type ContentStatus, type ShowType } from "../schema.ts";
import { freeSlug, versionOf, type NotSaved, type Saved } from "./common.ts";
import { isUuid, type ArtistValues } from "./input.ts";
import { getMedia, type AdminMedia } from "./media.ts";
import { tagChoices, type AdminFacetChoice, type AdminTagChoice } from "./tags.ts";

export type AdminArtistRow = {
  id: string;
  slug: string;
  name: string;
  role: ArtistRole;
  status: ContentStatus;
  shows: number;
  hasPhoto: boolean;
  hasBio: boolean;
  updatedAt: Date;
  /** Les noms de ses étiquettes (ce qu'il fait), dans l'ordre alphabétique. */
  tags: string[];
};

/** L'index A–Z de l'admin : une lettre par groupe, « # » à la fin. */
export type AdminArtistIndex = { total: number; groups: { letter: string; artists: AdminArtistRow[] }[] };

/** Les filtres de l'index ; `tag` : l'identifiant d'une étiquette ; `missing` : ce qui manque, « photo » ou « bio ». */
export type AdminArtistFilters = { q?: string; role?: string; status?: string; tag?: string; missing?: string };

/** Une fiche sans photo : le tableau de bord les compte, l'index les filtre. */
export const lacksPhoto = () => sql`${artist.photoId} is null`;

/** Une fiche sans bio (ou rien que des espaces). */
export const lacksBio = () => sql`coalesce(btrim(${artist.bio}), '') = ''`;

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
  if (isUuid(filters.tag)) conditions.push(sql`exists (select 1 from ${artistTag} ag where ag.artist_id = ${outer(artist.id)} and ag.tag_id in ${coveredTagIds(filters.tag)})`);
  if (filters.missing === "photo") conditions.push(lacksPhoto());
  else if (filters.missing === "bio") conditions.push(lacksBio());
  const rows = await tx
    .select({
      id: artist.id,
      slug: artist.slug,
      name: artist.name,
      role: artist.role,
      status: artist.status,
      shows: sql<number>`(select count(*) from ${showArtist} sa where sa.artist_id = ${outer(artist.id)})`.mapWith(Number),
      hasPhoto: sql<boolean>`${artist.photoId} is not null`,
      hasBio: sql<boolean>`not ${lacksBio()}`,
      updatedAt: artist.updatedAt,
      tags: sql<string[]>`coalesce((select json_agg(t.name order by t.name) from ${artistTag} ag join ${tag} t on t.id = ag.tag_id
        where ag.artist_id = ${outer(artist.id)}), '[]'::json)`,
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
  photo: AdminMedia | null;
  /** Ses étiquettes (ce qu'il fait : podcast, playlist, DJ), dans l'ordre alphabétique. */
  tags: { id: string; name: string }[];
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
  const photo = await getMedia(tx, photoId);
  const shows = await tx
    .select({ id: show.id, title: show.title, type: show.type, status: show.status, broadcastAt: show.broadcastAt })
    .from(showArtist)
    .innerJoin(show, eq(show.id, showArtist.showId))
    .where(eq(showArtist.artistId, id))
    .orderBy(sql`${show.broadcastAt} desc nulls first`, desc(show.updatedAt));
  const tags = (
    await tx
      .select({ id: tag.id, name: tag.name })
      .from(artistTag)
      .innerJoin(tag, eq(tag.id, artistTag.tagId))
      .where(eq(artistTag.artistId, id))
  ).sort((a, b) => frenchOrder.compare(a.name, b.name));
  return { ...fields, photo, tags, shows };
}

/** Les filtres des artistes et leurs étiquettes, à proposer dans la fiche d'un artiste. */
export const artistChoices = (tx: Tx): Promise<{ facets: AdminFacetChoice[]; tags: AdminTagChoice[] }> => tagChoices(tx, "artist");

/** Remplace les étiquettes d'un artiste ; celles qui n'existent plus sont ignorées. */
async function setArtistTags(tx: Tx, artistId: string, ids: string[]) {
  const existing = ids.length ? (await tx.select({ id: tag.id }).from(tag).where(inArray(tag.id, ids))).map((row) => row.id) : [];
  await tx.delete(artistTag).where(eq(artistTag.artistId, artistId));
  if (existing.length) await tx.insert(artistTag).values(existing.map((tagId) => ({ artistId, tagId })));
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
    await setArtistTags(tx, id, values.tags);
    return { ok: true, id, slug, newArtists: [], newTags: [] };
  }
  const [created] = await tx.insert(artist).values(fields).returning({ id: artist.id });
  await setArtistTags(tx, created!.id, values.tags);
  return { ok: true, id: created!.id, slug, newArtists: [], newTags: [] };
}

/**
 * Supprime un artiste : il disparaît des shows et des événements qui le citaient. Rend son nom, et sa photo, à retirer
 * si elle ne sert plus (releaseMedia).
 */
export async function deleteArtist(tx: Tx, id: string): Promise<{ name: string; photoId: string | null } | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(artist).where(eq(artist.id, id)).returning({ name: artist.name, photoId: artist.photoId });
  return removed ?? null;
}
