/**
 * La recherche du site (la loupe) : plein texte en français dans Postgres, sur les shows, les artistes et les
 * événements publiés.
 *
 *   - Français : les mots sont ramenés à leur racine (« musiques électroniques » trouve « musique électronique »).
 *   - Sans accents ni majuscules : « eloise » trouve « Éloïse » (configuration public.french_unaccent).
 *   - Début de mot : chaque mot tapé vaut pour les mots qui commencent par lui (« jaz » trouve « Jazz »), sauf une
 *     lettre seule au milieu de la recherche, trop vague (« a & b » ne trouve pas tout ce qui commence par b).
 *   - Un show ou un événement se trouve aussi par le nom de ses artistes (pas leur bio) ; un show, par ses étiquettes
 *     et sa tracklist.
 *   - Les noms faits de mots vides (« Elle & Lui », que la recherche plein texte ignore) se trouvent par une
 *     comparaison simple, sans accents, sur les titres et les noms.
 * Les résultats viennent par type, les plus pertinents d'abord : un titre ou un nom qui commence par la recherche
 * passe devant.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "../access.ts";
import { artist, event, eventArtist, show, showArtist, showTag, tag, track, SEARCH_CONFIG } from "../schema.ts";
import { outer } from "./common.ts";
import { artistCardFields, toArtistCard, type ArtistCard } from "./artists.ts";
import { eventCardFields, toEventCard, type EventCard } from "./events.ts";
import { showCardFields, toShowCard, type ShowCard } from "./shows.ts";

export type SearchResults = { query: string; shows: ShowCard[]; artists: ArtistCard[]; events: EventCard[] };

const MAX_WORDS = 8;
const MAX_LENGTH = 200;

/**
 * La requête plein texte : chaque mot (lettres et chiffres seulement) devient un début de mot, tous exigés.
 * « Éloïse V » → « Éloïse:* & V:* » (la dernière lettre est peut-être le début du mot en cours de frappe).
 * Ponctuation et opérateurs tapés sont des séparateurs, jamais de la syntaxe. `weight` (« A ») ne retient que les
 * mots de ce poids : les noms des artistes, sans leur bio.
 */
export function prefixQuery(input: string, weight: "" | "A" = ""): string | null {
  const words = input
    .normalize("NFC")
    .slice(0, MAX_LENGTH)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_WORDS);
  const last = words.length - 1;
  return words.length ? words.map((word, index) => (word.length > 1 || index === last ? `${word}:*${weight}` : weight ? `${word}:${weight}` : word)).join(" & ") : null;
}

/** Pour LIKE : les caractères spéciaux tapés comptent pour eux-mêmes. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

export async function search(tx: Tx, base: string, input: string, { limit = 10 }: { limit?: number } = {}): Promise<SearchResults> {
  const query = typeof input === "string" ? input.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH) : "";
  const perType = Math.min(50, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 10));
  const empty: SearchResults = { query, shows: [], artists: [], events: [] };
  const words = prefixQuery(query);
  // Moins de deux caractères utiles : trop vague pour chercher.
  if (!words || query.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return empty;

  const config = sql.raw(`'${SEARCH_CONFIG}'::regconfig`);
  const tsquery = sql`to_tsquery(${config}, ${words})`;
  const nameQuery = sql`to_tsquery(${config}, ${prefixQuery(query, "A")})`;
  const plain = sql`private.immutable_unaccent(lower(${escapeLike(query)}))`;
  const matches = (vector: AnyPgColumn) => sql`${vector} @@ ${tsquery}`;
  const rank = (vector: AnyPgColumn) => sql`ts_rank_cd(${vector}, ${tsquery})`;
  const contains = (column: AnyPgColumn) => sql`private.immutable_unaccent(lower(${column})) like '%' || ${plain} || '%'`;
  const startsWith = (column: AnyPgColumn) => sql`private.immutable_unaccent(lower(${column})) like ${plain} || '%'`;
  const bonus = (condition: SQL, points: number) => sql`(case when ${condition} then ${sql.raw(String(points))} else 0 end)`;

  // Le nom d'un artiste (poids A de son vecteur), pas sa bio.
  const artistNamed = sql`(a.search @@ ${nameQuery} or private.immutable_unaccent(lower(a.name)) like '%' || ${plain} || '%')`;

  // Shows : le titre et la description, puis les artistes, les étiquettes et la tracklist.
  const byArtist = sql`exists (select 1 from ${showArtist} sa join ${artist} a on a.id = sa.artist_id
    where sa.show_id = ${outer(show.id)} and a.status = 'published' and ${artistNamed})`;
  const byTag = sql`exists (select 1 from ${showTag} st join ${tag} t on t.id = st.tag_id where st.show_id = ${outer(show.id)} and t.search @@ ${tsquery})`;
  const byTrack = sql`exists (select 1 from ${track} tr where tr.show_id = ${outer(show.id)} and tr.search @@ ${tsquery})`;
  const showRank = sql`${rank(show.search)} + ${bonus(startsWith(show.title), 1)} + ${bonus(byArtist, 0.5)} + ${bonus(byTag, 0.2)}`;
  const shows = await tx
    .select(showCardFields)
    .from(show)
    .where(and(eq(show.status, "published"), sql`(${matches(show.search)} or ${contains(show.title)} or ${byArtist} or ${byTag} or ${byTrack})`))
    .orderBy(desc(showRank), desc(show.broadcastAt), asc(show.title))
    .limit(perType);

  const artistRank = sql`${rank(artist.search)} + ${bonus(startsWith(artist.name), 1)}`;
  const artists = await tx
    .select(artistCardFields)
    .from(artist)
    .where(and(eq(artist.status, "published"), sql`(${matches(artist.search)} or ${contains(artist.name)})`))
    .orderBy(desc(artistRank), asc(artist.name))
    .limit(perType);

  // Événements : le titre, le lieu, la description, puis les artistes.
  const eventByArtist = sql`exists (select 1 from ${eventArtist} ea join ${artist} a on a.id = ea.artist_id
    where ea.event_id = ${outer(event.id)} and a.status = 'published' and ${artistNamed})`;
  const eventRank = sql`${rank(event.search)} + ${bonus(startsWith(event.title), 1)} + ${bonus(eventByArtist, 0.5)}`;
  const events = await tx
    .select(eventCardFields)
    .from(event)
    .where(and(eq(event.status, "published"), sql`(${matches(event.search)} or ${contains(event.title)} or ${eventByArtist})`))
    .orderBy(desc(eventRank), desc(event.startsAt), asc(event.title))
    .limit(perType);

  return {
    query,
    shows: shows.map((row) => toShowCard(base, row)),
    artists: artists.map((row) => toArtistCard(base, row)),
    events: events.map((row) => toEventCard(base, row)),
  };
}
