/**
 * Modèle de données du CMS de Parabole Radio, dans le Postgres de Supabase (schéma public).
 *
 * Les contenus des croquis : les shows (épisodes archivés ou à venir) et leur tracklist, les artistes (résidents et
 * invités), les événements et leur galerie, les étiquettes et les filtres du site qui les rangent, les pages simples,
 * les fichiers envoyés sur Supabase Storage. Et l'équipe qui les remplit : les membres, admin ou éditeur, reliés aux
 * comptes de Supabase Auth.
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
import { bigint, boolean, check, customType, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

// ---------------------------------------------------------------------------------------------------------------
// Types énumérés
// ---------------------------------------------------------------------------------------------------------------

export const contentStatus = pgEnum("content_status", ["draft", "published"]);
export const showType = pgEnum("show_type", ["dj_set", "playlist", "podcast"]);
export const artistRole = pgEnum("artist_role", ["resident", "guest"]);
export const teamRole = pgEnum("team_role", ["admin", "editor"]);
/** Ce que range un filtre : des shows, des artistes ou des événements. */
export const facetScope = pgEnum("facet_scope", ["show", "artist", "event"]);
/** L'antenne libre : les sept couleurs du télétexte, le sort d'un message, qui l'a décidé, ce que fait un mot interdit. */
export const chatColor = pgEnum("chat_color", ["red", "green", "yellow", "blue", "magenta", "cyan", "white"]);
export const chatStatus = pgEnum("chat_status", ["visible", "held", "refused", "removed"]);
export const chatDecider = pgEnum("chat_decider", ["rules", "team", "reports"]);
export const chatTermAction = pgEnum("chat_term_action", ["refuse", "hold", "mask"]);
export const chatLinks = pgEnum("chat_links", ["none", "music", "all"]);
/** Qui a lancé un import de la programmation Radio Cult : la tâche de nuit, ou un membre depuis l'admin. */
export const importTrigger = pgEnum("import_trigger", ["cron", "manual"]);

export type ContentStatus = (typeof contentStatus.enumValues)[number];
export type ShowType = (typeof showType.enumValues)[number];
export type ArtistRole = (typeof artistRole.enumValues)[number];
export type TeamRole = (typeof teamRole.enumValues)[number];
export type FacetScope = (typeof facetScope.enumValues)[number];
export type ChatColor = (typeof chatColor.enumValues)[number];
export type ChatStatus = (typeof chatStatus.enumValues)[number];
export type ChatDecider = (typeof chatDecider.enumValues)[number];
export type ChatTermAction = (typeof chatTermAction.enumValues)[number];
export type ChatLinks = (typeof chatLinks.enumValues)[number];
export type ImportTrigger = (typeof importTrigger.enumValues)[number];

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

/**
 * Une étiquette : un genre (Amapiano), une région (Caraïbes), un thème (Cinéma), une activité (DJ), une catégorie
 * d'événement (Fête). Elle se pose sur les shows, les artistes ou les événements, et se range dans les filtres du site
 * (facet, tag_group, tag_member) : une étiquette sans place est « à classer ». Toujours publique.
 */
export const tag = pgTable(
  "tag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Une adresse par étiquette, quelle que soit sa place : « /show?genre=amapiano » comme « ?geographie=amapiano ». */
    slug: text("slug").notNull().unique(),
    search: searchVector(weighted("name", "B")),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [slugFormat("tag", t.slug), index("tag_search").using("gin", t.search)],
).enableRLS();

/**
 * Un filtre du site : un classement d'étiquettes (le genre, la géographie, le thème…) pour les shows, les artistes ou
 * les événements. Ses groupes sont dans tag_group, et les étiquettes de chaque groupe dans tag_member.
 */
export const facet = pgTable(
  "facet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Le nom du filtre dans les adresses du site : « /show?genre=club ». */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    scope: facetScope("scope").notNull(),
    /** Pour les shows : les types qu'il range (les podcasts ; les DJ sets et les playlists). Vide : tous. */
    showTypes: showType("show_types").array().notNull().default(sql`'{}'`),
    /** Une aide pour l'équipe, montrée dans l'admin. */
    description: text("description"),
    /** 1, 2, 3… : l'ordre des filtres, dans l'admin et sur le site. */
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    slugFormat("facet", t.slug),
    check("facet_position", sql`${t.position} >= 1`),
    check("facet_show_types", sql`${t.scope} = 'show' or cardinality(${t.showTypes}) = 0`),
  ],
).enableRLS();

/**
 * Un groupe d'un filtre : une étiquette rangée au premier niveau (Club dans Genre, Caraïbes dans Géographie). Elle se
 * choisit comme les autres (un show « Jazz », sans plus de précision) et vaut, sur le site, pour tout son groupe.
 */
export const tagGroup = pgTable(
  "tag_group",
  {
    facetId: uuid("facet_id")
      .notNull()
      .references(() => facet.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    /** 1, 2, 3… : l'ordre des groupes dans leur filtre. */
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.facetId, t.tagId] }), check("tag_group_position", sql`${t.position} >= 1`), index("tag_group_tag").on(t.tagId)],
).enableRLS();

/**
 * Une étiquette rangée dans un groupe : Amapiano dans Club. Une étiquette peut avoir plusieurs places (Amapiano est
 * aussi dans Afrique / Moyen-Orient). Les étiquettes d'un groupe se montrent dans l'ordre alphabétique.
 */
export const tagMember = pgTable(
  "tag_member",
  {
    facetId: uuid("facet_id").notNull(),
    /** L'étiquette du groupe. */
    groupId: uuid("group_id").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.facetId, t.groupId, t.tagId] }),
    // Le groupe doit exister dans ce filtre ; le retirer retire ses étiquettes de ce groupe (pas de la base).
    foreignKey({ name: "tag_member_group_fk", columns: [t.facetId, t.groupId], foreignColumns: [tagGroup.facetId, tagGroup.tagId] }).onDelete("cascade"),
    check("tag_member_not_its_group", sql`${t.groupId} <> ${t.tagId}`),
    index("tag_member_tag").on(t.tagId),
  ],
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

/** Les étiquettes d'un artiste : ce qu'il fait (podcast, playlist, DJ), le filtre de la page Résidents. */
export const artistTag = pgTable(
  "artist_tag",
  {
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artist.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.tagId] }), index("artist_tag_tag").on(t.tagId)],
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
    /** Le mood d'un DJ set ou d'une playlist, sur l'échelle du site : de 1 (calme) à 4 (énergique). La contrainte accepte encore 5 (ancienne échelle), lu 4. */
    energy: smallint("energy"),
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
    check("show_energy", sql`${t.energy} is null or ${t.energy} between 1 and 5`),
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

/**
 * Une soirée, une expo, une rencontre : à venir tant qu'elle n'est pas finie. Sa catégorie (Fête, Rencontre/Talk…) est
 * une étiquette (event_tag).
 */
export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
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

/** Les étiquettes d'un événement : sa catégorie (Fête, Rencontre/Talk…), montrée sous l'événement. */
export const eventTag = pgTable(
  "event_tag",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.tagId] }), index("event_tag_tag").on(t.tagId)],
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

/** Une page de texte : les mentions légales (slug « mentions-legales »)… À propos a sa propre table, about_page. */
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

/**
 * Une ligne de L'ÉQUIPE ou des CRÉDITS de la page À propos : ce que fait la personne (vide permis), son nom, et un lien
 * facultatif (sa page de résident, son site, la source d'un emprunt).
 */
export type AboutCredit = { role: string; name: string; url?: string };

/**
 * La page À propos (cms/README.md, 9.10), sur une seule ligne posée par la migration : les panneaux du croquis du
 * 3 novembre (DESCRIPTION et les réseaux sociaux, L'ÉQUIPE et les CRÉDITS, CONTACT et CANDIDATER) et le film qu'on y
 * lance. Toujours en ligne : pas de brouillon. Les mentions légales sont une page à part (page « mentions-legales »).
 */
export const aboutPage = pgTable(
  "about_page",
  {
    id: boolean("id").primaryKey().default(true),
    /** Qui est Parabole, en Markdown. */
    description: text("description").notNull().default(""),
    /** Les réseaux de la radio, dans l'ordre : [{ label, url }], comme les liens d'un artiste. */
    socials: jsonb("socials").$type<ArtistLink[]>().notNull().default([]),
    /** Dans l'ordre d'affichage : [{ role, name }]. */
    team: jsonb("team").$type<AboutCredit[]>().notNull().default([]),
    credits: jsonb("credits").$type<AboutCredit[]>().notNull().default([]),
    /** L'adresse de CONTACT. Vide : le bloc ne s'affiche pas. */
    contactEmail: text("contact_email"),
    /** CANDIDATER : quelques mots (Markdown), où mène le bouton (le formulaire), et ce qu'il dit. */
    applyText: text("apply_text").notNull().default(""),
    applyUrl: text("apply_url"),
    applyLabel: text("apply_label").notNull().default("Music lover ?!"),
    /**
     * Le film, qu'on lance depuis la page : la vidéo (Vercel Blob, ou un chemin du site), son image fixe, son titre
     * (dit aux lecteurs d'écran), et ce que le navigateur en a lu à l'envoi. Sans vidéo, pas de film.
     */
    filmUrl: text("film_url"),
    filmPosterUrl: text("film_poster_url"),
    filmTitle: text("film_title").notNull().default(""),
    filmMimeType: text("film_mime_type"),
    filmSizeBytes: bigint("film_size_bytes", { mode: "number" }),
    filmDurationSeconds: integer("film_duration_seconds"),
    filmWidth: integer("film_width"),
    filmHeight: integer("film_height"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("about_page_single", sql`${t.id}`),
    check("about_page_lists", sql`jsonb_typeof(${t.socials}) = 'array' and jsonb_typeof(${t.team}) = 'array' and jsonb_typeof(${t.credits}) = 'array'`),
    check("about_page_contact_email", sql`${t.contactEmail} is null or ${t.contactEmail} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("about_page_apply_url", sql`${t.applyUrl} is null or ${t.applyUrl} ~ '^(https?://|mailto:)'`),
    check("about_page_film", sql`(${t.filmUrl} is null) = (${t.filmMimeType} is null) and (${t.filmMimeType} is null or ${t.filmMimeType} in ('video/mp4', 'video/webm'))`),
    check("about_page_film_url", sql`${t.filmUrl} is null or ${t.filmUrl} ~ '^(/[^/]|https://)'`),
    check("about_page_film_poster_url", sql`${t.filmPosterUrl} is null or ${t.filmPosterUrl} ~ '^(/[^/]|https://)'`),
    check("about_page_film_dimensions", sql`(${t.filmWidth} is null) = (${t.filmHeight} is null) and coalesce(${t.filmWidth} > 0 and ${t.filmHeight} > 0, true)`),
    check("about_page_film_size", sql`${t.filmSizeBytes} is null or ${t.filmSizeBytes} >= 0`),
    check("about_page_film_duration", sql`${t.filmDurationSeconds} is null or ${t.filmDurationSeconds} > 0`),
  ],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Vidéos de fond
// ---------------------------------------------------------------------------------------------------------------

/**
 * Un clip du fond du site : les vidéos muettes qui passent au hasard derrière toutes les pages, l'une après l'autre.
 * Le fichier est dans le site (public/, les clips d'origine : « /PARABOLE RADIO/VIDEO/BACKGROUND/background4.mp4 »)
 * ou sur Vercel Blob (https://…, envoyé depuis l'admin). Publié : dans la rotation ; brouillon : mis de côté. La
 * place dans la liste (position) donne l'ordre de l'admin et le numéro de chaîne.
 */
export const backgroundClip = pgTable(
  "background_clip",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** « Kiss FM Paris (INA) ». Le site peut l'afficher à l'arrivée du clip ; vide, le numéro seul. */
    title: text("title").notNull().default(""),
    /** La vidéo : un chemin du site (« /PARABOLE RADIO/… ») ou une adresse https de Vercel Blob. */
    videoUrl: text("video_url").notNull().unique(),
    /** Sa première image, montrée pendant que la vidéo charge. */
    posterUrl: text("poster_url"),
    /** « video/mp4 » ou « video/webm ». */
    mimeType: text("mime_type").notNull().default("video/mp4"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationSeconds: integer("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    /** 1, 2, 3… : l'ordre de la liste. Deux clips de même place se départagent par leur date d'ajout. */
    position: integer("position").notNull(),
    status: contentStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("background_clip_video_url", sql`${t.videoUrl} ~ '^(/[^/]|https://)'`),
    check("background_clip_poster_url", sql`${t.posterUrl} is null or ${t.posterUrl} ~ '^(/[^/]|https://)'`),
    check("background_clip_position", sql`${t.position} >= 1`),
    check("background_clip_dimensions", sql`(${t.width} is null) = (${t.height} is null) and coalesce(${t.width} > 0 and ${t.height} > 0, true)`),
    check("background_clip_size", sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
    check("background_clip_duration", sql`${t.durationSeconds} is null or ${t.durationSeconds} > 0`),
    index("background_clip_status_position").on(t.status, t.position),
  ],
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
// L'antenne libre : le chat du site (CHAT_EN_DIRECT.md)
// ---------------------------------------------------------------------------------------------------------------
// Le public n'a aucun droit sur ces tables, pas même en lecture : le serveur y écrit en propriétaire, après la
// modération, et la base diffuse elle-même ce qui passe à l'antenne (0010_antenne_acces.sql). L'équipe, la régie, les
// lit et les modère sous son rôle.

/**
 * Quelqu'un qui a passé un message à l'antenne : un pseudo, tenu par une session anonyme de notre serveur (un cookie,
 * dont la base ne garde que l'empreinte). Ni compte, ni e-mail.
 */
export const chatAuthor = pgTable(
  "chat_author",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** L'empreinte (SHA-256) du jeton de son cookie. */
    tokenHash: text("token_hash").notNull().unique(),
    pseudo: text("pseudo").notNull(),
    /** La forme comparée du pseudo, sans majuscules, accents ni lettres trompeuses : deux pseudos ne se ressemblent pas. */
    pseudoKey: text("pseudo_key").notNull().unique(),
    color: chatColor("color").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Exclu jusqu'à cette heure : il lit, il n'écrit plus. */
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedReason: text("banned_reason"),
    /** Le membre de l'équipe qui a banni. */
    bannedBy: uuid("banned_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("chat_author_pseudo", sql`char_length(${t.pseudo}) between 3 and 20`)],
).enableRLS();

/**
 * Un message, quelle que soit son issue : passé à l'antenne (visible), en attente de la régie (held), refusé (refused)
 * ou retiré, brouillé par la régie (removed). Ceux de la régie portent le membre à la place de l'auteur.
 */
export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").references(() => chatAuthor.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => member.userId, { onDelete: "set null" }),
    /** Le pseudo et la couleur au moment de l'envoi. */
    pseudo: text("pseudo").notNull(),
    color: chatColor("color").notNull(),
    body: text("body").notNull(),
    status: chatStatus("status").notNull(),
    /** Le passage à l'antenne : l'envoi, plus le différé. Avant, personne ne le voit, sauf son auteur. */
    onAirAt: timestamp("on_air_at", { withTimezone: true }).notNull().defaultNow(),
    /** Pourquoi il ne passe pas, ou plus : la raison lue par son auteur. */
    reason: text("reason"),
    decidedBy: chatDecider("decided_by").notNull().default("rules"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("chat_message_body", sql`char_length(${t.body}) between 1 and 160`),
    index("chat_message_status_on_air").on(t.status, t.onAirAt),
    index("chat_message_author_created").on(t.authorId, t.createdAt),
  ],
).enableRLS();

/** Un signalement : un auditeur signale un message, une fois. */
export const chatReport = pgTable(
  "chat_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessage.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => chatAuthor.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    /** Vu par la régie (le message gardé ou retiré). */
    handledAt: timestamp("handled_at", { withTimezone: true }),
    handledBy: uuid("handled_by"),
    createdAt: createdAt(),
  },
  (t) => [unique("chat_report_once").on(t.messageId, t.reporterId)],
).enableRLS();

/**
 * La liste de mots de la régie : un mot ou une expression, et ce qu'il fait d'un message (refusé, en attente, masqué).
 * Comparé en mot entier, ou partout (anywhere) pour les injures qu'on soude à d'autres mots.
 */
export const chatTerm = pgTable(
  "chat_term",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    term: text("term").notNull().unique(),
    action: chatTermAction("action").notNull().default("refuse"),
    anywhere: boolean("anywhere").notNull().default(false),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("chat_term_length", sql`char_length(${t.term}) between 2 and 60`)],
).enableRLS();

/** Le journal de l'antenne : chaque décision, des règles, des signalements ou de la régie (le membre). */
export const chatAction = pgTable(
  "chat_action",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: chatDecider("actor").notNull(),
    memberId: uuid("member_id"),
    /** refuse, hold, mask, remove, publish, reject, mute, ban, lift, clear, settings, term, rename, report, mute_auto. */
    action: text("action").notNull(),
    messageId: uuid("message_id"),
    authorId: uuid("author_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("chat_action_created").on(t.createdAt), index("chat_action_author").on(t.authorId, t.createdAt)],
).enableRLS();

/** Les réglages de l'antenne, sur une seule ligne, posée par la migration. */
export const chatSettings = pgTable(
  "chat_settings",
  {
    id: boolean("id").primaryKey().default(true),
    open: boolean("open").notNull().default(true),
    /** Le mode lent : un message toutes les N secondes par personne (0, 3, 5, 10, 30 ou 60). */
    slowSeconds: integer("slow_seconds").notNull().default(0),
    /** Le différé : N secondes entre l'envoi et le passage à l'antenne (0, 5, 10 ou 30). */
    delaySeconds: integer("delay_seconds").notNull().default(0),
    /** Le mode prudent : les deux premiers messages d'un nouveau pseudo attendent la régie. */
    careful: boolean("careful").notNull().default(false),
    /** Les messages défilent-ils dans le bandeau ? Sinon, seulement sur la page 888. */
    ticker: boolean("ticker").notNull().default(true),
    links: chatLinks("links").notNull().default("music"),
    /** À partir de combien de signalements un message est brouillé en attendant la régie. */
    reportThreshold: integer("report_threshold").notNull().default(3),
    /** Le dernier vidage : l'historique repart de là. */
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("chat_settings_single", sql`${t.id}`),
    check("chat_settings_slow", sql`${t.slowSeconds} in (0, 3, 5, 10, 30, 60)`),
    check("chat_settings_delay", sql`${t.delaySeconds} in (0, 5, 10, 30)`),
    check("chat_settings_threshold", sql`${t.reportThreshold} between 1 and 20`),
  ],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// L'import de la programmation Radio Cult (cms/README.md, 9.4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Un show dont l'import a changé ou signalé quelque chose : ce que dit le créneau de Radio Cult (`slotAt`, en ISO, et sa
 * durée en secondes) et ce que disait la fiche (`showAt`, `showDuration`). `filled` : ce que l'import a ajouté à un
 * brouillon qui ne l'avait pas encore (les artistes, la description).
 */
export type ImportChange = {
  id: string;
  title: string;
  slotAt: string;
  slotDuration: number | null;
  showAt: string | null;
  showDuration: number | null;
  filled?: ("artists" | "description")[];
};

/** Le détail d'un import réussi, que l'accueil de l'admin relit pour dire ce qui reste à faire. */
export type ImportReport = {
  /** Les brouillons créés pour les créneaux nouveaux. */
  created: { id: string; title: string; slotAt: string }[];
  /** Les brouillons qui ont suivi leur créneau (date, durée), ou reçu ses artistes ou sa description. */
  updated: ImportChange[];
  /** Les shows publiés dont le créneau a bougé : laissés tels quels, à corriger à la main. */
  moved: ImportChange[];
  /** Les shows dont le créneau a disparu de Radio Cult : jamais supprimés, signalés. */
  gone: { id: string; title: string; status: ContentStatus; showAt: string }[];
  /** Les artistes créés en brouillon, et ceux retrouvés par leur nom puis reliés à leur fiche Radio Cult. */
  artistsCreated: { id: string; name: string }[];
  artistsLinked: { id: string; name: string }[];
  /** Ce qui a manqué : la clé publishable, la liste des artistes, des artistes sans nom… */
  notes: string[];
};

/**
 * Le journal des imports de la programmation Radio Cult : une ligne par passage, de la tâche de nuit ou du bouton de
 * l'accueil. Un passage qui n'a pas pu lire Radio Cult y est aussi, avec la raison (`error`). L'équipe le lit ; seul le
 * serveur, ou un membre en son propre nom, y écrit.
 */
export const radiocultImport = pgTable(
  "radiocult_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: importTrigger("trigger").notNull(),
    /** Le membre qui l'a lancé depuis l'admin ; vide pour la tâche de nuit. */
    memberId: uuid("member_id").references(() => member.userId, { onDelete: "set null" }),
    /** La période lue chez Radio Cult : de maintenant à dans 14 jours. */
    rangeStart: timestamp("range_start", { withTimezone: true }).notNull(),
    rangeEnd: timestamp("range_end", { withTimezone: true }).notNull(),
    /** Les créneaux lus, les shows créés, mis à jour, et laissés tels quels. */
    slots: integer("slots").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    /** Pourquoi le passage a échoué (Radio Cult injoignable…) ; vide s'il a réussi. */
    error: text("error"),
    report: jsonb("report").$type<ImportReport | Record<string, never>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    check("radiocult_import_counts", sql`${t.slots} >= 0 and ${t.created} >= 0 and ${t.updated} >= 0 and ${t.unchanged} >= 0`),
    check("radiocult_import_report_object", sql`jsonb_typeof(${t.report}) = 'object'`),
    index("radiocult_import_created").on(t.createdAt),
  ],
).enableRLS();

// ---------------------------------------------------------------------------------------------------------------
// Relations (requêtes imbriquées de Drizzle : db.query.show.findFirst({ with: { tracks: true } }))
// ---------------------------------------------------------------------------------------------------------------

export const mediaRelations = relations(media, ({ many }) => ({ eventPhotos: many(eventPhoto) }));

export const tagRelations = relations(tag, ({ many }) => ({
  shows: many(showTag),
  artists: many(artistTag),
  events: many(eventTag),
  groups: many(tagGroup),
  memberships: many(tagMember),
}));

export const facetRelations = relations(facet, ({ many }) => ({ groups: many(tagGroup) }));

export const tagGroupRelations = relations(tagGroup, ({ one, many }) => ({
  facet: one(facet, { fields: [tagGroup.facetId], references: [facet.id] }),
  tag: one(tag, { fields: [tagGroup.tagId], references: [tag.id] }),
  members: many(tagMember),
}));

export const tagMemberRelations = relations(tagMember, ({ one }) => ({
  group: one(tagGroup, { fields: [tagMember.facetId, tagMember.groupId], references: [tagGroup.facetId, tagGroup.tagId] }),
  tag: one(tag, { fields: [tagMember.tagId], references: [tag.id] }),
}));

export const artistRelations = relations(artist, ({ one, many }) => ({
  photo: one(media, { fields: [artist.photoId], references: [media.id] }),
  shows: many(showArtist),
  events: many(eventArtist),
  tags: many(artistTag),
}));

export const artistTagRelations = relations(artistTag, ({ one }) => ({
  artist: one(artist, { fields: [artistTag.artistId], references: [artist.id] }),
  tag: one(tag, { fields: [artistTag.tagId], references: [tag.id] }),
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
  tags: many(eventTag),
}));

export const eventTagRelations = relations(eventTag, ({ one }) => ({
  event: one(event, { fields: [eventTag.eventId], references: [event.id] }),
  tag: one(tag, { fields: [eventTag.tagId], references: [tag.id] }),
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
export type Facet = typeof facet.$inferSelect;
export type NewFacet = typeof facet.$inferInsert;
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
export type BackgroundClip = typeof backgroundClip.$inferSelect;
export type NewBackgroundClip = typeof backgroundClip.$inferInsert;
export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
export type ChatAuthor = typeof chatAuthor.$inferSelect;
export type ChatMessage = typeof chatMessage.$inferSelect;
export type ChatTerm = typeof chatTerm.$inferSelect;
export type ChatSettings = typeof chatSettings.$inferSelect;
export type RadioCultImport = typeof radiocultImport.$inferSelect;
