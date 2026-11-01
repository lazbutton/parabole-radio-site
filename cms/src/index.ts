/**
 * Le CMS de Parabole Radio, pour le projet Astro :
 *   - connect() : la base (Supabase par DATABASE_URL, PGlite en local) ;
 *   - createReader() : les fonctions de lecture du site, sous le rôle du public ;
 *   - createAdmin() : les lectures et les écritures des écrans d'admin, sous le rôle de la personne connectée
 *     (asMember), et la vérification de leurs saisies ;
 *   - le schéma Drizzle (schema.show, schema.track…), ses types et les libellés français ;
 *   - l'heure de Paris et les minutages (aussi dans le navigateur : @parabole/cms/tracklist).
 */
export { asMember, asPublic, withViewer, type Tx, type Viewer } from "./access.ts";
export * from "./admin/index.ts";
export { connect, type ConnectOptions, type Connection, type Db } from "./db.ts";
export { LABELS } from "./labels.ts";
export { mediaUrl, startOfParisDay } from "./read/common.ts";
export { fromParisInput, STATION_TIME_ZONE, toParisInput } from "./paris.ts";
export { indexLetter } from "./read/artists.ts";
export { prefixQuery } from "./read/search.ts";
export {
  createReader,
  type ArtistCard,
  type ArtistDetail,
  type ArtistIndex,
  type ArtistRef,
  type EventCard,
  type EventDetail,
  type EventFilters,
  type EventPhoto,
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
  type TagCount,
  type TagRef,
} from "./read/index.ts";
export * as schema from "./schema.ts";
export type {
  Artist,
  ArtistLink,
  ArtistRole,
  ContentStatus,
  Event,
  EventCategory,
  Media,
  MediaVariant,
  Member,
  NewArtist,
  NewEvent,
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
  TagKind,
  TeamRole,
  Track,
} from "./schema.ts";
export { isSlug, slugify } from "./slug.ts";
export { formatTimecode, parseTimecode, parseTracklist, type TrackLine } from "./tracklist.ts";
