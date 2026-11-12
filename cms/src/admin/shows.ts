/**
 * Les shows dans l'admin : la liste (brouillons compris), la fiche à modifier avec ses artistes, ses étiquettes et sa
 * tracklist, l'enregistrement, la suppression. Tout passe sous le rôle de la personne connectée (src/admin/index.ts) :
 * les règles d'accès de la base s'appliquent.
 */
import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { coveredTagIds, frenchOrder, oneOf, outer, paging, type Paged } from "../read/common.ts";
import { escapeLike, prefixQuery } from "../read/search.ts";
import { artist, audioFile, contentStatus, SEARCH_CONFIG, show, showArtist, showTag, showType, tag, track, type ContentStatus, type ShowType } from "../schema.ts";
import { slugify } from "../slug.ts";
import { freeSlug, versionOf, type NotSaved, type Saved } from "./common.ts";
import { awaitsAssembly, awaitsReview, awaitsSlot, sendFailed } from "./envois.ts";
import { isUuid, type ArtistPick, type ShowValues, type TagPick } from "./input.ts";
import { getMedia, type AdminMedia } from "./media.ts";
import { tagChoices, type AdminFacetChoice, type AdminTagChoice } from "./tags.ts";

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
  hasCover: boolean;
  hasDescription: boolean;
  /** Le nombre de ses étiquettes. */
  tags: number;
  /** L'émission vient de l'import Radio Cult. */
  fromRadioCult: boolean;
  /** Où elle en est : à traiter, en attente, en ligne (SHOW_STEPS). */
  step: ShowStep;
  /** Ce qui la laisse « à traiter » : les infos obligatoires qui manquent, et ce qui attend l'équipe (SHOW_LACKS). */
  lacking: ShowLack[];
};

export type AdminShowFilters = {
  /** Recherche : titre, description, artistes, tracklist. */
  q?: string;
  status?: string;
  /** Où elle en est : « todo » (à traiter), « waiting » (en attente), « online » (en ligne). */
  step?: string;
  type?: string;
  /** Identifiant d'une étiquette : celle-ci, ou une étiquette de son groupe. */
  tag?: string;
  /** Identifiant d'un artiste. */
  artist?: string;
  /**
   * Ce qui manque à une émission déjà diffusée : « tracklist », « sound » (la piste SoundCloud), « cover » (la pochette),
   * « description », « tags » (aucune étiquette des filtres). Et ce qui attend l'équipe dans les envois des résidents :
   * « review » (son à écouter), « failed » (refusé par SoundCloud), « assemble » (playlist à assembler), « slot » (envoi
   * sans créneau).
   */
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

/** Déjà diffusée : ce qui manque ne compte qu'une fois l'émission passée à l'antenne (une émission sans date, jamais). */
const aired = (now: Date) => sql`${show.broadcastAt} <= ${now.toISOString()}::timestamptz`;

/**
 * Une émission diffusée sans tracklist : le tableau de bord les compte, la liste les filtre. Pas les podcasts : ils
 * n'en ont pas forcément.
 */
export const lacksTracklist = (now: Date) =>
  sql`(${aired(now)} and ${show.type} <> 'podcast' and not exists (select 1 from ${track} tr where tr.show_id = ${outer(show.id)}))`;

/** Une émission diffusée sans piste SoundCloud : le lecteur du site n'a rien à jouer. */
export const lacksSound = (now: Date) => sql`(${aired(now)} and ${show.soundcloudTrackId} is null)`;

/** Une émission diffusée sans pochette : le site montre la vignette de son type. */
export const lacksCover = (now: Date) => sql`(${aired(now)} and ${show.coverId} is null)`;

/** Une émission diffusée sans description. */
export const lacksDescription = (now: Date) => sql`(${aired(now)} and ${blankDescription})`;

/** Une émission diffusée sans aucune étiquette : les filtres du site ne la trouvent pas. */
export const lacksTags = (now: Date) => sql`(${aired(now)} and not exists (select 1 from ${showTag} st where st.show_id = ${outer(show.id)}))`;

// ---------------------------------------------------------------------------------------------------------------
// Où en est une émission : à traiter, en attente, en ligne (retours de l'équipe du 11 nov. 2026)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Les trois états d'une émission dans l'admin, calculés (rien n'est rangé à la main) :
 *   - « online », en ligne : publiée sur le site ;
 *   - « todo », à traiter : en brouillon, il lui manque une info obligatoire du formulaire, ou quelque chose attend
 *     l'équipe (un son à écouter, une playlist à assembler, un envoi sans créneau, SoundCloud en échec) ;
 *   - « waiting », en attente : en brouillon, tout est là ; elle attend sa diffusion, puis SoundCloud la publie.
 */
export const SHOW_STEPS = ["todo", "waiting", "online"] as const;
export type ShowStep = (typeof SHOW_STEPS)[number];

/** Une description vide, ou faite seulement d'espaces et de retours à la ligne. */
const blankDescription = sql`coalesce(${show.description}, '') !~ '[^[:space:]]'`;

/** Un son prêt : validé (ou parti, ou en route vers SoundCloud), ou la piste SoundCloud renseignée à la main. */
const hasReadySound = () =>
  sql`(${show.soundcloudTrackId} is not null or exists (select 1 from ${audioFile} af where af.show_id = ${outer(show.id)} and af.role = 'main' and af.status in ('approved', 'sending', 'sent')))`;

/**
 * Les infos obligatoires du formulaire d'une émission : la date de diffusion, la pochette, la description, les
 * étiquettes, le mood (sauf podcast), la tracklist (sauf podcast), le son. Il les faut toutes pour la publier à la main.
 */
const REQUIRED: { key: ShowLack; when: () => SQL }[] = [
  { key: "date", when: () => sql`${show.broadcastAt} is null` },
  { key: "cover", when: () => sql`${show.coverId} is null` },
  { key: "description", when: () => blankDescription },
  { key: "tags", when: () => sql`not exists (select 1 from ${showTag} st where st.show_id = ${outer(show.id)})` },
  { key: "mood", when: () => sql`(${show.type} <> 'podcast' and ${show.energy} is null)` },
  { key: "tracklist", when: () => sql`(${show.type} <> 'podcast' and not exists (select 1 from ${track} tr where tr.show_id = ${outer(show.id)}))` },
  { key: "sound", when: () => sql`not ${hasReadySound()}` },
];

/** Ce qui attend l'équipe dans les envois des résidents (9.12) : une émission concernée reste « à traiter ». */
const WAITING_FOR_TEAM: { key: ShowLack; when: () => SQL }[] = [
  { key: "review", when: awaitsReview },
  { key: "failed", when: sendFailed },
  { key: "assemble", when: awaitsAssembly },
  { key: "slot", when: awaitsSlot },
];

/** Ce qui laisse une émission « à traiter », dans l'ordre où on le dit. */
export const SHOW_LACKS = ["date", "cover", "description", "tags", "mood", "tracklist", "sound", "review", "failed", "assemble", "slot"] as const;
export type ShowLack = (typeof SHOW_LACKS)[number];

const LACKING = [...REQUIRED, ...WAITING_FOR_TEAM];

/** La liste de ce qui manque à une émission, ou attend l'équipe (vide : elle est prête). */
export const lackingOf = () => sql<ShowLack[]>`array_remove(array[${sql.join(
  LACKING.map(({ key, when }) => sql`case when ${when()} then ${key}::text end`),
  sql`, `,
)}]::text[], null)`;

/** Une émission prête : rien d'obligatoire ne manque, rien n'attend l'équipe. */
const isReady = () => sql`not (${sql.join(LACKING.map(({ when }) => sql`(${when()})`), sql` or `)})`;

/** Son état : en ligne si elle est publiée ; sinon en attente si elle est prête, à traiter sinon. */
export const stepOf = () => sql<ShowStep>`(case when ${show.status} = 'published' then 'online' when ${isReady()} then 'waiting' else 'todo' end)`;

/** Les conditions de « À compléter », par valeur du filtre. */
// Les envois des résidents (cms/README.md, 9.12) passent par la même table : le tableau de bord compte comme la liste.
const LACKS: Record<string, (now: Date) => SQL> = {
  tracklist: lacksTracklist,
  sound: lacksSound,
  cover: lacksCover,
  description: lacksDescription,
  tags: lacksTags,
  review: awaitsReview,
  failed: sendFailed,
  assemble: awaitsAssembly,
  slot: awaitsSlot,
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
  if (filters.step && oneOf(SHOW_STEPS, filters.step)) conditions.push(sql`${stepOf()} = ${filters.step}`);
  if (filters.type && oneOf(showType.enumValues, filters.type)) conditions.push(eq(show.type, filters.type));
  if (isUuid(filters.tag)) conditions.push(sql`exists (select 1 from ${showTag} st where st.show_id = ${outer(show.id)} and st.tag_id in ${coveredTagIds(filters.tag)})`);
  if (isUuid(filters.artist)) conditions.push(sql`exists (select 1 from ${showArtist} sa where sa.show_id = ${outer(show.id)} and sa.artist_id = ${filters.artist})`);
  if (filters.missing && Object.hasOwn(LACKS, filters.missing)) conditions.push(LACKS[filters.missing]!(filters.now ?? new Date()));
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
      hasCover: sql<boolean>`${show.coverId} is not null`,
      hasDescription: sql<boolean>`not ${blankDescription}`,
      tags: sql<number>`(select count(*) from ${showTag} st where st.show_id = ${outer(show.id)})`.mapWith(Number),
      fromRadioCult: sql<boolean>`${show.radiocultEventId} is not null`,
      step: stepOf(),
      lacking: lackingOf(),
    })
    .from(show)
    .where(where)
    .orderBy(...order)
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await tx.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(show).where(where);
  return { items: rows, total: count?.total ?? 0, ...page };
}

/** Combien d'émissions à traiter, en attente, en ligne : pour les pastilles de la liste et l'accueil. */
export async function countSteps(tx: Tx): Promise<Record<ShowStep, number>> {
  const rows = await tx.select({ step: stepOf(), n: sql<number>`count(*)`.mapWith(Number) }).from(show).groupBy(sql`1`);
  const counts: Record<ShowStep, number> = { todo: 0, waiting: 0, online: 0 };
  for (const { step, n } of rows) counts[step] = n;
  return counts;
}

/** Les infos obligatoires qui manquent pour publier à la main : celles du formulaire, et la pochette et le son de la fiche. */
async function missingToPublish(tx: Tx, id: string | undefined, values: ShowValues): Promise<ShowLack[]> {
  const [saved] = id
    ? await tx
        .select({ hasCover: sql<boolean>`${show.coverId} is not null`, hasSound: hasReadySound() })
        .from(show)
        .where(eq(show.id, id))
    : [];
  const lacks: (ShowLack | false)[] = [
    !values.broadcastAt && "date",
    !saved?.hasCover && "cover",
    !/[^\s]/.test(values.description ?? "") && "description",
    !values.tags.length && "tags",
    values.type !== "podcast" && values.energy == null && "mood",
    values.type !== "podcast" && !values.tracks.length && "tracklist",
    !values.soundcloudTrackId && !saved?.hasSound && "sound",
  ];
  return lacks.filter((lack): lack is ShowLack => Boolean(lack));
}

/** Les infos obligatoires, en mots : « la pochette », « le son »… */
const REQUIRED_WORDS: Partial<Record<ShowLack, string>> = {
  date: "la date de diffusion",
  cover: "la pochette",
  description: "la description",
  tags: "les étiquettes",
  mood: "le mood",
  tracklist: "la tracklist",
  sound: "le son",
};

/** « la pochette, la tracklist et le son » */
const inWords = (lacks: ShowLack[]) => {
  const words = lacks.map((lack) => REQUIRED_WORDS[lack] ?? lack);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} et ${words.at(-1)}` : (words[0] ?? "");
};

// ---------------------------------------------------------------------------------------------------------------
// La fiche
// ---------------------------------------------------------------------------------------------------------------

export type AdminShowArtist = { id: string; name: string; status: ContentStatus };
export type AdminTag = { id: string; name: string };

export type AdminShow = {
  id: string;
  slug: string;
  title: string;
  type: ShowType;
  status: ContentStatus;
  broadcastAt: Date | null;
  durationSeconds: number | null;
  energy: number | null;
  description: string | null;
  soundcloudUrl: string | null;
  soundcloudTrackId: string | null;
  radiocultEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Jeton de version (src/admin/common.ts), à renvoyer avec la fiche. */
  version: string;
  cover: AdminMedia | null;
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
      energy: show.energy,
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
  const cover = await getMedia(tx, coverId);
  const artists = await tx
    .select({ id: artist.id, name: artist.name, status: artist.status })
    .from(showArtist)
    .innerJoin(artist, eq(artist.id, showArtist.artistId))
    .where(eq(showArtist.showId, id))
    .orderBy(asc(showArtist.position), asc(artist.name));
  const tags = (
    await tx
      .select({ id: tag.id, name: tag.name })
      .from(showTag)
      .innerJoin(tag, eq(tag.id, showTag.tagId))
      .where(eq(showTag.showId, id))
  ).sort((a, b) => frenchOrder.compare(a.name, b.name));
  const tracks = await tx
    .select({ artist: track.artist, title: track.title, startSeconds: track.startSeconds, hopperUrl: track.hopperUrl })
    .from(track)
    .where(eq(track.showId, id))
    .orderBy(asc(track.position));
  return { ...fields, cover, artists, tags, tracks };
}

/**
 * Ce que propose la fiche d'un show : les artistes, dans l'ordre alphabétique français ; les étiquettes des filtres des
 * shows, dans l'ordre de ces filtres, avec leurs places, puis celles à classer ; et ces filtres, pour montrer où ira le
 * show.
 */
export async function showChoices(tx: Tx): Promise<{ artists: AdminShowArtist[]; tags: AdminTagChoice[]; facets: AdminFacetChoice[] }> {
  const artists = await tx.select({ id: artist.id, name: artist.name, status: artist.status }).from(artist);
  const { tags, facets } = await tagChoices(tx, "show", { unplaced: true });
  return { artists: artists.sort((a, b) => frenchOrder.compare(a.name, b.name)), tags, facets };
}

// ---------------------------------------------------------------------------------------------------------------
// L'enregistrement
// ---------------------------------------------------------------------------------------------------------------

/** Le même nom, sans les accents ni les majuscules : « eloise vachon » retrouve « Éloïse Vachon ». */
export const sameName =(column: typeof artist.name | typeof tag.name, name: string) => sql`private.immutable_unaccent(lower(${column})) = private.immutable_unaccent(lower(${name}))`;

/**
 * Les artistes choisis, dans l'ordre : un nom nouveau retrouve l'artiste du même nom, ou en crée un, en brouillon. Sert
 * aussi aux événements (src/admin/events.ts).
 */
export async function resolveArtists(tx: Tx, picks: ArtistPick[]): Promise<{ ids: string[]; created: string[] }> {
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

/** Les étiquettes choisies : une étiquette nouvelle retrouve celle du même nom ou de la même adresse, ou naît, sans place. */
export async function resolveTags(tx: Tx, picks: TagPick[]): Promise<{ ids: string[]; created: string[] }> {
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
        .where(or(eq(tag.slug, slug), sameName(tag.name, pick.name)))
        .orderBy(sql`${tag.slug} = ${slug} desc`)
        .limit(1);
      id = same?.id;
      if (!id) {
        const [born] = await tx.insert(tag).values({ name: pick.name, slug }).returning({ id: tag.id });
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
  let wasPublished = false;
  if (id !== undefined) {
    const gone: NotSaved = { ok: false, errors: { form: "Cette émission n'existe plus : elle a peut-être été supprimée." } };
    if (!isUuid(id)) return gone;
    const [current] = await tx.select({ version: versionOf(show.updatedAt), status: show.status }).from(show).where(eq(show.id, id)).for("update");
    if (!current) return gone;
    if (version !== undefined && version !== current.version)
      return {
        ok: false,
        version: current.version,
        errors: { form: "Quelqu'un a enregistré cette émission pendant que tu la modifiais. Enregistre de nouveau pour remplacer sa version par la tienne." },
      };
    finalStatus = status ?? current.status;
    wasPublished = current.status === "published";
  }
  if (finalStatus === "published" && !values.broadcastAt) return { ok: false, errors: { broadcastAt: "Il faut une date de diffusion pour publier." } };
  // Publier à la main demande les infos obligatoires ; une émission déjà en ligne s'enregistre comme avant.
  if (finalStatus === "published" && !wasPublished) {
    const lacks = await missingToPublish(tx, id, values);
    if (lacks.length) return { ok: false, errors: { form: `Pour publier, il manque ${inWords(lacks)}.` } };
  }
  let slug = values.slug;
  const [clash] = await tx
    .select({ title: show.title })
    .from(show)
    .where(and(eq(show.slug, slug), id ? ne(show.id, id) : undefined))
    .limit(1);
  if (clash) {
    if (!values.slugFromTitle) return { ok: false, errors: { slug: `Cette adresse sert déjà à l'émission « ${clash.title} ».` } };
    slug = await freeSlug(tx, show, slug, id);
  }

  const fields = {
    slug,
    title: values.title,
    type: values.type,
    broadcastAt: values.broadcastAt,
    durationSeconds: values.durationSeconds,
    energy: values.energy,
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

/**
 * Supprime un show, avec sa tracklist et ses liens. Rend son titre, et sa pochette, à retirer si elle ne sert plus
 * (releaseMedia).
 */
export async function deleteShow(tx: Tx, id: string): Promise<{ title: string; coverId: string | null } | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(show).where(eq(show.id, id)).returning({ title: show.title, coverId: show.coverId });
  return removed ?? null;
}
