/**
 * Les fonctions de lecture du site, réunies : chacune lit sous le rôle anon, dans une transaction en lecture seule,
 * et ne voit donc que le publié (règles d'accès, drizzle/0002_acces.sql). Les requêtes filtrent aussi le publié
 * elles-mêmes : deux barrières plutôt qu'une.
 *
 *   const { db } = await connect();
 *   const cms = createReader(db, { mediaBaseUrl: import.meta.env.PUBLIC_MEDIA_URL });
 *   const { items } = await cms.listShows({ type: "dj_set", tags: ["club"], energy: { min: 4 } });
 *
 * Une valeur venue d'une adresse et inconnue (type, catégorie, slug mal formé) donne une liste vide ou null, jamais
 * une erreur.
 */
import { asPublic } from "../access.ts";
import type { Db } from "../db.ts";
import { getArtist, listArtists, type ArtistFilters } from "./artists.ts";
import { listBackgroundClips } from "./clips.ts";
import { getEvent, listEvents, type EventFilters } from "./events.ts";
import { listFacets, type FacetFilters } from "./facets.ts";
import { getPage } from "./pages.ts";
import { search } from "./search.ts";
import { getShow, listAirings, listShows, type ShowFilters } from "./shows.ts";

export type ReaderOptions = {
  /** L'adresse publique du seau des fichiers (PUBLIC_MEDIA_URL) : « https://<ref>.supabase.co/storage/v1/object/public/media ». */
  mediaBaseUrl: string;
};

export function createReader(db: Db, { mediaBaseUrl }: ReaderOptions) {
  return {
    /** Les shows publiés, filtrés par type, étiquettes, mood, artiste et période, avec pagination. */
    listShows: (filters: ShowFilters = {}) => asPublic(db, (tx) => listShows(tx, mediaBaseUrl, filters)),
    /** Un show avec sa tracklist et ses artistes, ou null. */
    getShow: (slug: string) => asPublic(db, (tx) => getShow(tx, mediaBaseUrl, slug)),
    /** Les diffusions (shows publiés de durée connue) qui croisent un intervalle, avec les slugs de leurs artistes. */
    listAirings: (range: { from: Date; to: Date }) => asPublic(db, (tx) => listAirings(tx, range)),
    /** Les filtres d'une page (shows d'un type, artistes, événements), avec le nombre de contenus de chaque étiquette. */
    listFacets: (filters: FacetFilters) => asPublic(db, (tx) => listFacets(tx, filters)),
    /** Les artistes publiés, résidents ou invités, par activité, en index A–Z. */
    listArtists: (filters: ArtistFilters = {}) => asPublic(db, (tx) => listArtists(tx, mediaBaseUrl, filters)),
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
    /** Les vidéos de fond de la rotation, dans l'ordre de la liste de l'admin. */
    listBackgroundClips: () => asPublic(db, (tx) => listBackgroundClips(tx)),
  };
}

export type Reader = ReturnType<typeof createReader>;

export type { ArtistCard, ArtistDetail, ArtistFilters, ArtistIndex, ArtistNeighbor } from "./artists.ts";
export type { ClipCard } from "./clips.ts";
export type { ArtistRef, Image, Paged, TagRef } from "./common.ts";
export type { EventCard, EventDetail, EventFilters, EventPhoto } from "./events.ts";
export type { FacetFilters, FacetGroup, FacetMenu, FacetTag } from "./facets.ts";
export type { PageContent } from "./pages.ts";
export type { SearchResults } from "./search.ts";
export type { Airing, ShowCard, ShowDetail, ShowFilters, ShowTrack } from "./shows.ts";
