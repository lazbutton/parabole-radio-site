/**
 * Le CMS de Parabole Radio, pour le projet Astro :
 *   - connect() : la base (Supabase par DATABASE_URL, PGlite en local) ;
 *   - createReader() : les fonctions de lecture du site, sous le rôle du public ;
 *   - createAdmin() : les lectures et les écritures des écrans d'admin, sous le rôle de la personne connectée
 *     (asMember), et la vérification de leurs saisies ;
 *   - le schéma Drizzle (schema.show, schema.track…), ses types et les libellés français ;
 *   - l'import de la programmation Radio Cult (importRadioCult, pour la tâche de nuit) et la traduction des réponses
 *     de son API ;
 *   - l'heure de Paris et les minutages (aussi dans le navigateur : @parabole/cms/tracklist).
 */
export { asMember, asPublic, withViewer, type Tx, type Viewer } from "./access.ts";
export * from "./admin/index.ts";
export { createAntenne, type Antenne, type EtatAntenne, type Envoi, type Issue, type MessageAntenne, type Moi } from "./chat/index.ts";
export { COULEURS as CHAT_COLORS, estCouleur } from "./chat/forme.ts";
export { connect, type ConnectOptions, type Connection, type Db } from "./db.ts";
export { ENERGY, LABELS } from "./labels.ts";
export { coveredTags, mediaUrl, startOfParisDay } from "./read/common.ts";
export { fromParisInput, STATION_TIME_ZONE, toParisInput } from "./paris.ts";
export { indexLetter } from "./read/artists.ts";
export {
  artistFromRadioCult,
  importRadioCult,
  markdownFrom,
  slotsFromRadioCult,
  type ImportInput,
  type ImportResult,
  type ImportRun,
  type ImportStatus,
  type RadioCultArtist,
  type RadioCultSlot,
} from "./radiocult/index.ts";
export { prefixQuery } from "./read/search.ts";
export {
  createReader,
  type AboutContent,
  type AboutFilm,
  type Airing,
  type ArtistCard,
  type ArtistDetail,
  type ArtistFilters,
  type ArtistIndex,
  type ArtistNeighbor,
  type ArtistRef,
  type ClipCard,
  type EventCard,
  type EventDetail,
  type EventFilters,
  type EventPhoto,
  type FacetFilters,
  type FacetGroup,
  type FacetMenu,
  type FacetTag,
  type Image,
  type PageContent,
  type Paged,
  type Reader,
  type ReaderOptions,
  type SearchResults,
  type ShowCard,
  type ShowDetail,
  type ShowFilters,
  type ShowTrack,
  type TagRef,
} from "./read/index.ts";
export * as schema from "./schema.ts";
export type {
  AboutCredit,
  Artist,
  ArtistLink,
  ArtistRole,
  BackgroundClip,
  ContentStatus,
  Event,
  Facet,
  FacetScope,
  ImportChange,
  ImportReport,
  ImportTrigger,
  Media,
  MediaVariant,
  Member,
  NewArtist,
  NewBackgroundClip,
  NewEvent,
  NewFacet,
  NewMedia,
  NewMember,
  NewPage,
  NewShow,
  NewTag,
  NewTrack,
  Page,
  Show,
  ShowType,
  Tag,
  TeamRole,
  Track,
} from "./schema.ts";
export { isSlug, slugify } from "./slug.ts";
export { formatTimecode, parseTimecode, parseTracklist, type TrackLine } from "./tracklist.ts";
