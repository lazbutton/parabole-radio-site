/**
 * Les fonctions de lecture du site, réunies : chacune lit sous le rôle anon, dans une transaction en lecture seule,
 * et ne voit donc que le publié (règles d'accès, drizzle/0002_acces.sql). Les requêtes filtrent aussi le publié
 * elles-mêmes : deux barrières plutôt qu'une.
 *
 *   const { db } = await connect();
 *   const cms = createReader(db, { mediaBaseUrl: import.meta.env.PUBLIC_MEDIA_URL });
 *   const { items } = await cms.listShows({ type: "dj_set", genre: "house" });
 *
 * Une valeur venue d'une adresse et inconnue (type, catégorie, slug mal formé) donne une liste vide ou null, jamais
 * une erreur.
 */
import { asPublic } from "../access.ts";
import type { Db } from "../db.ts";
import type { ArtistRole, ShowType, TagKind } from "../schema.ts";
import { getArtist, listArtists } from "./artists.ts";
import { getEvent, listEvents, type EventFilters } from "./events.ts";
import { getPage } from "./pages.ts";
import { search } from "./search.ts";
import { getShow, listShows, listTags, type ShowFilters } from "./shows.ts";

export type ReaderOptions = {
  /** L'adresse publique du seau R2 des fichiers (PUBLIC_MEDIA_URL) : « https://media.parabole.radio ». */
  mediaBaseUrl: string;
};

export function createReader(db: Db, { mediaBaseUrl }: ReaderOptions) {
  return {
    /** Les shows publiés, filtrés par type, genre, mood, thème, artiste et période, avec pagination. */
    listShows: (filters: ShowFilters = {}) => asPublic(db, (tx) => listShows(tx, mediaBaseUrl, filters)),
    /** Un show avec sa tracklist et ses artistes, ou null. */
    getShow: (slug: string) => asPublic(db, (tx) => getShow(tx, mediaBaseUrl, slug)),
    /** Les étiquettes en usage, avec leur nombre de shows : les menus de tri. */
    listTags: (filters: { kind?: TagKind; type?: ShowType } = {}) => asPublic(db, (tx) => listTags(tx, filters)),
    /** Les artistes publiés, résidents ou invités, en index A–Z. */
    listArtists: (filters: { role?: ArtistRole } = {}) => asPublic(db, (tx) => listArtists(tx, mediaBaseUrl, filters)),
    /** Un artiste avec ses shows et ses événements, ou null. */
    getArtist: (slug: string) => asPublic(db, (tx) => getArtist(tx, mediaBaseUrl, slug)),
    /** Les événements à venir ou passés, par catégorie, avec pagination. */
    listEvents: (filters: EventFilters) => asPublic(db, (tx) => listEvents(tx, mediaBaseUrl, filters)),
    /** Un événement avec ses artistes et sa galerie, ou null. */
    getEvent: (slug: string) => asPublic(db, (tx) => getEvent(tx, mediaBaseUrl, slug)),
    /** Une page publiée (À propos…), ou null. */
    getPage: (slug: string) => asPublic(db, (tx) => getPage(tx, slug)),
    /** La recherche plein texte en français, sans accents, sur les shows, les artistes et les événements. */
    search: (query: string, options: { limit?: number } = {}) => asPublic(db, (tx) => search(tx, mediaBaseUrl, query, options)),
  };
}

export type Reader = ReturnType<typeof createReader>;

export type { ArtistCard, ArtistDetail, ArtistIndex } from "./artists.ts";
export type { ArtistRef, Image, Paged, TagRef } from "./common.ts";
export type { EventCard, EventDetail, EventFilters, EventPhoto } from "./events.ts";
export type { PageContent } from "./pages.ts";
export type { SearchResults } from "./search.ts";
export type { ShowCard, ShowDetail, ShowFilters, ShowTrack, TagCount } from "./shows.ts";
