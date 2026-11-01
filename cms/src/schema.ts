/**
 * Modèle de données du CMS de Parabole Radio, dans le Postgres de Supabase (schéma public).
 *
 * Les contenus des croquis : les shows (épisodes archivés ou à venir) et leur tracklist, les artistes (résidents et
 * invités), les événements et leur galerie, les étiquettes typées des shows, les pages simples, les fichiers envoyés
 * sur Supabase Storage. Et l'équipe qui les remplit : les membres, admin ou éditeur, reliés aux comptes de Supabase Auth.
 *
 * Ce fichier décrit les tables ; drizzle-kit en tire les migrations (drizzle/). Ce qu'il ne sait pas écrire est dans
 * des migrations écrites à la main : l'extension unaccent et la configuration de recherche française avant les
 * tables (0000_prelude.sql), les règles d'accès (RLS), les droits et les déclencheurs après (0002_acces.sql).
 *
 * Conventions :
 *   - identifiants uuid, adresse publique par slug (« dimanche-house-a-la-chapelle ») ;
 *   - statut brouillon ou publié sur tout ce que le site montre : seul le publié est lisible par le public ;
 *   - textes longs (description, bio, corps de page) en Markdown ;
 *   - heures en timestamptz (UTC dans la base, affichées à l'heure de Paris par le site) ;
 *   - colonne « search » : le vecteur de la recherche plein texte, calculé par Postgres, jamais écrit à la main.
 */
import { relations, sql, type SQL } from "drizzle-orm";
import { bigint, check, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

// ---------------------------------------------------------------------------------------------------------------
// Types énumérés
// ---------------------------------------------------------------------------------------------------------------

export const contentStatus = pgEnum("content_status", ["draft", "published"]);
export const showType = pgEnum("show_type", ["dj_set", "playlist", "podcast"]);
export const tagKind = pgEnum("tag_kind", ["genre", "mood", "theme"]);
export const artistRole = pgEnum("artist_role", ["resident", "guest"]);
export const eventCategory = pgEnum("event_category", ["art_ensemble", "parabole", "special", "talk"]);
export const teamRole = pgEnum("team_role", ["admin", "editor"]);

export type ContentStatus = (typeof contentStatus.enumValues)[number];
export type ShowType = (typeof showType.enumValues)[number];
export type TagKind = (typeof tagKind.enumValues)[number];
export type ArtistRole = (typeof artistRole.enumValues)[number];
export type EventCategory = (typeof eventCategory.enumValues)[number];
export type TeamRole = (typeof teamRole.enumValues)[number];

// ---------------------------------------------------------------------------------------------------------------
// Briques communes
// ---------------------------------------------------------------------------------------------------------------

/** Le vecteur de la recherche plein texte. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Configuration de recherche française sans accents (0000_prelude.sql) : « Éloïse » et « eloise » donnent le même
 * mot, « musiques électroniques » se trouve avec « musique électronique ».
 */
export const SEARCH_CONFIG = "public.french_unaccent";

/** Un texte pondéré pour la recherche : A pour le titre ou le nom, B pour le lieu, C pour la description. */
const weighted = (column: string, weight: "A" | "B" | "C" | "D") =>
  `setweight(to_tsvector('${SEARCH_CONFIG}'::regconfig, coalesce(${column}, '')), '${weight}')`;
const searchVector = (...parts: string[]) => tsvector("search").generatedAlwaysAs((): SQL => sql.raw(parts.join(" || ")));

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Tenu par un déclencheur (0002_acces.sql), quel que soit le chemin de l'écriture. */
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Minuscules, chiffres et tirets simples : « nuit-parabole-2026 ». slugify() (src/slug.ts) en fabrique un. */
const slugFormat = (table: string, column: AnyPgColumn) => check(`${table}_slug_format`, sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`);

// ---------------------------------------------------------------------------------------------------------------
// Fichiers envoyés
// ---------------------------------------------------------------------------------------------------------------

/** Une version réduite d'une image, en WebP, dans le seau public « media » de Supabase Storage. */
export type MediaVariant = { width: number; key: string };

/**
 * Un fichier envoyé sur Supabase Storage : son adresse publique est l'adresse du seau suivie de la clé. Une image porte
 * ses dimensions, son texte alternatif et ses versions réduites (WebP, faites à l'envoi) pour un srcset.
 * Le public ne lit que les fichiers d'un contenu publié (0002_acces.sql).
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Clé de l'objet dans le seau « media » : « images/2026/10/3f2a….webp ». */
    key: text("key").notNull().unique(),
    /** Type MIME : « image/webp », « image/jpeg », « application/pdf »… */
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    /** Texte alternatif, lu par les lecteurs d'écran. Vide pour une image décorative. */
    alt: text("alt").notNull().default(""),
    /** Crédit photo : « © Prénom Nom ». */
    credit: text("credit"),
    variants: jsonb("variants").$type<MediaVariant[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("media_dimensions", sql`(${t.width} is null) = (${t.height} is null) and coalesce(${t.width} > 0 and ${t.height} > 0, true)`),
    check("media_size", sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
    check("media_variants_array", sql`jsonb_typeof(${t.variants}) = 'array'`),
  ],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Étiquettes
// ---------------------------------------------------------------------------------------------------------------

/** Une étiquette de show : un genre (house), un mood (calme) ou un thème (quartier). Toujours publique. */
export const tag = pgTable(
  "tag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: tagKind("kind").notNull(),
    name: text("name").notNull(),
    /** Unique dans son type : un genre et un mood peuvent tous deux s'appeler « ambient ». */
    slug: text("slug").notNull(),
    search: searchVector(weighted("name", "B")),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("tag_kind_slug").on(t.kind, t.slug), slugFormat("tag", t.slug), index("tag_search").using("gin", t.search)],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Artistes
// ---------------------------------------------------------------------------------------------------------------

/** Un lien d'artiste : « Instagram », « SoundCloud », « Site »… */
export type ArtistLink = { label: string; url: string };

/** Un résident ou un invité de la radio. */
export const artist = pgTable(
  "artist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    role: artistRole("role").notNull().default("guest"),
    /** Markdown. */
    bio: text("bio"),
    photoId: uuid("photo_id").references(() => media.id, { onDelete: "set null" }),
    links: jsonb("links").$type<ArtistLink[]>().notNull().default([]),
    status: contentStatus("status").notNull().default("draft"),
    /** L'artiste chez Radio Cult : l'import de la programmation relie ses créneaux à cette fiche. */
    radiocultArtistId: text("radiocult_artist_id").unique(),
    search: searchVector(weighted("name", "A"), weighted("bio", "C")),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    slugFormat("artist", t.slug),
    check("artist_links_array", sql`jsonb_typeof(${t.links}) = 'array'`),
    index("artist_role_status").on(t.role, t.status),
    index("artist_photo").on(t.photoId),
    index("artist_search").using("gin", t.search),
  ],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------------------------------------------

/**
 * Un épisode, archivé ou à venir : un DJ set, une playlist ou un podcast. Le son est sur le compte SoundCloud de
 * Parabole ; le lecteur du site le joue grâce à l'identifiant de la piste (URN « soundcloud:tracks:<id> »).
 */
export const show = pgTable(
  "show",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    type: showType("type").notNull(),
    status: contentStatus("status").notNull().default("draft"),
    /** Date et heure de diffusion. Obligatoire pour publier : les listes sont triées par elle. */
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    /** Markdown. */
    description: text("description"),
    /** Image carrée (vignette et pochette). */
    coverId: uuid("cover_id").references(() => media.id, { onDelete: "set null" }),
    /** Page de la piste : « https://soundcloud.com/parabole-radio/… ». À montrer près du lecteur (conditions de SoundCloud). */
    soundcloudUrl: text("soundcloud_url"),
    /** Identifiant numérique de la piste, pour l'API de SoundCloud. */
    soundcloudTrackId: text("soundcloud_track_id").unique(),
    /** Le créneau de la programmation Radio Cult dont ce show vient (import quotidien en brouillons). */
    radiocultEventId: text("radiocult_event_id").unique(),
    search: searchVector(weighted("title", "A"), weighted("description", "C")),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    slugFormat("show", t.slug),
    check("show_published_has_date", sql`${t.status} = 'draft' or ${t.broadcastAt} is not null`),
    check("show_duration", sql`${t.durationSeconds} is null or ${t.durationSeconds} > 0`),
    check("show_soundcloud_url", sql`${t.soundcloudUrl} is null or ${t.soundcloudUrl} ~ '^https://([a-z]+\\.)?soundcloud\\.com/'`),
    check("show_soundcloud_track_id", sql`${t.soundcloudTrackId} is null or ${t.soundcloudTrackId} ~ '^[0-9]+$'`),
    index("show_status_broadcast").on(t.status, t.broadcastAt),
    index("show_cover").on(t.coverId),
    index("show_search").using("gin", t.search),
  ],
).enableRLS();

/** Les artistes d'un show, dans l'ordre d'affichage (« A b2b B »). */
export const showArtist = pgTable(
  "show_artist",
  {
    showId: uuid("show_id")
      .notNull()
      .references(() => show.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artist.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.showId, t.artistId] }), index("show_artist_artist").on(t.artistId)],
).enableRLS();

export const showTag = pgTable(
  "show_tag",
  {
    showId: uuid("show_id")
      .notNull()
      .references(() => show.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.showId, t.tagId] }), index("show_tag_tag").on(t.tagId)],
).enableRLS();

/**
 * La tracklist d'un show : un morceau par ligne, dans l'ordre (position 1, 2, 3…). L'écran d'édition la remplace en
 * entier à chaque enregistrement, dans une transaction.
 */
export const track = pgTable(
  "track",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => show.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    artist: text("artist").notNull(),
    title: text("title").notNull(),
    /** Minutage : secondes depuis le début du show. */
    startSeconds: integer("start_seconds"),
    /** Page Hopper du morceau (https://hppr.fr/…), qui l'ouvre sur la plateforme de chaque auditeur. */
    hopperUrl: text("hopper_url"),
    search: searchVector(weighted("artist", "D"), weighted("title", "D")),
  },
  (t) => [
    unique("track_show_position").on(t.showId, t.position),
    check("track_position", sql`${t.position} >= 1`),
    check("track_start", sql`${t.startSeconds} is null or ${t.startSeconds} >= 0`),
    check("track_hopper_url", sql`${t.hopperUrl} is null or ${t.hopperUrl} ~ '^https://hppr\\.fr/'`),
    index("track_search").using("gin", t.search),
  ],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------------------------------------------

/** Une soirée, une expo, une rencontre : à venir tant qu'elle n'est pas finie. */
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    category: eventCategory("category").notNull(),
    status: contentStatus("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Fin, si elle est connue. Sans fin, l'événement passe dans « passés » à son début. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Le lieu : « La Goutte d'Or » ; son adresse à part, pour un lien vers une carte. */
    venue: text("venue"),
    address: text("address"),
    /** Markdown. */
    description: text("description"),
    visualId: uuid("visual_id").references(() => media.id, { onDelete: "set null" }),
    ticketUrl: text("ticket_url"),
    search: searchVector(weighted("title", "A"), weighted("venue", "B"), weighted("description", "C")),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    slugFormat("event", t.slug),
    check("event_dates", sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
    check("event_ticket_url", sql`${t.ticketUrl} is null or ${t.ticketUrl} ~ '^https?://'`),
    index("event_status_starts").on(t.status, t.startsAt),
    index("event_visual").on(t.visualId),
    index("event_search").using("gin", t.search),
  ],
).enableRLS();

export const eventArtist = pgTable(
  "event_artist",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artist.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.artistId] }), index("event_artist_artist").on(t.artistId)],
).enableRLS();

/** La galerie d'un événement, dans l'ordre de défilement. */
export const eventPhoto = pgTable(
  "event_photo",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Légende, en plus du texte alternatif de l'image. */
    caption: text("caption"),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.mediaId] }), index("event_photo_media").on(t.mediaId)],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Pages simples
// ---------------------------------------------------------------------------------------------------------------

/** Une page de texte : À propos (slug « a-propos »), mentions légales… */
export const page = pgTable(
  "page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** Markdown. */
    body: text("body").notNull().default(""),
    status: contentStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [slugFormat("page", t.slug)],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// L'équipe
// ---------------------------------------------------------------------------------------------------------------

/**
 * Un membre de l'équipe : un compte de Supabase Auth (connexion par lien magique) et son rôle. L'admin gère les
 * membres et tous les contenus ; l'éditeur, les contenus seulement. Un compte sans ligne ici n'a pas plus de droits
 * que le public. Les auditeurs n'ont jamais de compte.
 */
export const member = pgTable(
  "member",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    /** Copié de Supabase Auth à l'invitation : l'équipe ne lit pas auth.users. */
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: teamRole("role").notNull().default("editor"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("member_email", sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`)],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Relations (requêtes imbriquées de Drizzle : db.query.show.findFirst({ with: { tracks: true } }))
// ---------------------------------------------------------------------------------------------------------------

export const mediaRelations = relations(media, ({ many }) => ({ eventPhotos: many(eventPhoto) }));

export const tagRelations = relations(tag, ({ many }) => ({ shows: many(showTag) }));

export const artistRelations = relations(artist, ({ one, many }) => ({
  photo: one(media, { fields: [artist.photoId], references: [media.id] }),
  shows: many(showArtist),
  events: many(eventArtist),
}));

export const showRelations = relations(show, ({ one, many }) => ({
  cover: one(media, { fields: [show.coverId], references: [media.id] }),
  artists: many(showArtist),
  tags: many(showTag),
  tracks: many(track),
}));

export const showArtistRelations = relations(showArtist, ({ one }) => ({
  show: one(show, { fields: [showArtist.showId], references: [show.id] }),
  artist: one(artist, { fields: [showArtist.artistId], references: [artist.id] }),
}));

export const showTagRelations = relations(showTag, ({ one }) => ({
  show: one(show, { fields: [showTag.showId], references: [show.id] }),
  tag: one(tag, { fields: [showTag.tagId], references: [tag.id] }),
}));

export const trackRelations = relations(track, ({ one }) => ({ show: one(show, { fields: [track.showId], references: [show.id] }) }));

export const eventRelations = relations(event, ({ one, many }) => ({
  visual: one(media, { fields: [event.visualId], references: [media.id] }),
  artists: many(eventArtist),
  photos: many(eventPhoto),
}));

export const eventArtistRelations = relations(eventArtist, ({ one }) => ({
  event: one(event, { fields: [eventArtist.eventId], references: [event.id] }),
  artist: one(artist, { fields: [eventArtist.artistId], references: [artist.id] }),
}));

export const eventPhotoRelations = relations(eventPhoto, ({ one }) => ({
  event: one(event, { fields: [eventPhoto.eventId], references: [event.id] }),
  media: one(media, { fields: [eventPhoto.mediaId], references: [media.id] }),
}));

// ---------------------------------------------------------------------------------------------------------------
// Types des lignes
// ---------------------------------------------------------------------------------------------------------------

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;
export type Tag = typeof tag.$inferSelect;
export type NewTag = typeof tag.$inferInsert;
export type Artist = typeof artist.$inferSelect;
export type NewArtist = typeof artist.$inferInsert;
export type Show = typeof show.$inferSelect;
export type NewShow = typeof show.$inferInsert;
export type Track = typeof track.$inferSelect;
export type NewTrack = typeof track.$inferInsert;
export type Event = typeof event.$inferSelect;
export type NewEvent = typeof event.$inferInsert;
export type Page = typeof page.$inferSelect;
export type NewPage = typeof page.$inferInsert;
export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
