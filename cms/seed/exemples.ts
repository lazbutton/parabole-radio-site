/**
 * Le jeu d'exemples, pour développer et tester : des shows, des artistes, des événements et des pages inventés.
 *
 * Tout y est marqué comme exemple : les noms et les titres finissent par « (exemple) », les slugs commencent par
 * « exemple- », les clés des fichiers par « exemples/ » (ces fichiers n'existent pas dans le Storage). removeExamples() les
 * retire tous, sans toucher au reste. Les dates partent de `now` : un événement « à venir » le reste.
 *
 * Les contenus portent les vraies étiquettes des filtres (« house », « dj », « fete » : la migration 0007 les inscrit),
 * plus deux étiquettes d'exemple sans place, « à classer ». Une vraie étiquette supprimée entre-temps est sautée.
 *
 * Écrit par le propriétaire des tables, que les règles d'accès laissent passer.
 */
import { like, sql } from "drizzle-orm";
import type { Db } from "../src/db.ts";
import { startOfParisDay } from "../src/read/common.ts";
import {
  artist,
  artistTag,
  event,
  eventArtist,
  eventPhoto,
  eventTag,
  media,
  page,
  show,
  showArtist,
  showTag,
  tag,
  track,
  type ArtistRole,
  type ContentStatus,
  type MediaVariant,
  type ShowType,
} from "../src/schema.ts";

export const EXAMPLE_SLUG_PREFIX = "exemple-";
export const EXAMPLE_MEDIA_PREFIX = "exemples/";

const HOUR = 3_600_000;

type ExampleMedia = { ref: string; key: string; width?: number; height?: number; alt: string; credit?: string; variants?: MediaVariant[] };
type ExampleTag = { name: string; slug: string };
type ExampleArtist = {
  ref: string;
  slug: string;
  name: string;
  role: ArtistRole;
  status: ContentStatus;
  bio?: string;
  photo?: string;
  links?: { label: string; url: string }[];
  /** Les adresses de ses étiquettes (ce qu'il fait). */
  tags?: string[];
};
type ExampleTrack = { artist: string; title: string; at?: string; hopper?: string };
type ExampleShow = {
  slug: string;
  title: string;
  type: ShowType;
  status: ContentStatus;
  /** Jours depuis `now` (négatif : passé). */
  day: number;
  minutes?: number;
  /** Le mood, de 1 (calme) à 5 (énergique). */
  energy?: number;
  description?: string;
  cover?: string;
  soundcloud?: string;
  artists: string[];
  /** Les adresses de ses étiquettes. */
  tags: string[];
  tracks?: ExampleTrack[];
};
type ExampleEvent = {
  slug: string;
  title: string;
  /** Les adresses de ses étiquettes (sa catégorie). */
  tags: string[];
  status: ContentStatus;
  /** Heures depuis `now`. */
  startsIn: number;
  /** Ramené à minuit (heure de Paris) s'il tombait la veille. */
  sameDay?: boolean;
  hours?: number;
  venue?: string;
  address?: string;
  description?: string;
  visual?: string;
  ticketUrl?: string;
  artists: string[];
  photos?: { ref: string; caption?: string }[];
};

const square = (name: string, alt: string, credit?: string): ExampleMedia => ({
  ref: name,
  key: `${EXAMPLE_MEDIA_PREFIX}${name}.webp`,
  width: 1200,
  height: 1200,
  alt,
  credit,
  variants: [400, 800].map((width) => ({ width, key: `${EXAMPLE_MEDIA_PREFIX}${name}-${width}.webp` })),
});
const landscape = (name: string, alt: string, credit?: string): ExampleMedia => ({ ref: name, key: `${EXAMPLE_MEDIA_PREFIX}${name}.webp`, width: 1600, height: 900, alt, credit });

export const EXAMPLE_MEDIA: ExampleMedia[] = [
  square("pochette-dimanche-house", "Platines sous une lumière orange (image d'exemple)"),
  square("pochette-techno-de-minuit", "Salle sombre traversée d'un faisceau vert (image d'exemple)"),
  square("pochette-matin-calme", "Fenêtre sur les toits au lever du jour (image d'exemple)"),
  square("pochette-brouillon", "Pochette d'un show en brouillon (image d'exemple)"),
  square("portrait-eloise-vachon", "Portrait d'Éloïse Vachon, artiste inventée (image d'exemple)", "© Photographe exemple"),
  square("portrait-bastien-ocre", "Portrait de Bastien Ocre, artiste inventé (image d'exemple)"),
  square("portrait-ana-brouillon", "Portrait d'une artiste en brouillon (image d'exemple)"),
  landscape("visuel-nuit-parabole", "Affiche de la Nuit Parabole (image d'exemple)"),
  landscape("visuel-expo-sonore", "Haut-parleurs suspendus dans une galerie (image d'exemple)"),
  landscape("galerie-expo-1", "Visiteurs devant une installation sonore (image d'exemple)", "© Photographe exemple"),
  landscape("galerie-expo-2", "Casques posés sur un banc (image d'exemple)", "© Photographe exemple"),
  landscape("galerie-expo-3", "Câbles et console de mixage (image d'exemple)", "© Photographe exemple"),
  landscape("galerie-anniversaire-1", "Foule qui danse (image d'exemple)"),
  landscape("galerie-anniversaire-2", "Gâteau d'anniversaire en forme de parabole (image d'exemple)"),
  landscape("fichier-pas-encore-utilise", "Image envoyée mais pas encore placée (image d'exemple)"),
];

/** Deux étiquettes d'exemple, sans place dans les filtres : « à classer », comme celles créées depuis une fiche. */
export const EXAMPLE_TAGS: ExampleTag[] = [
  { name: "Quartier (exemple)", slug: `${EXAMPLE_SLUG_PREFIX}quartier` },
  { name: "Écologie (exemple)", slug: `${EXAMPLE_SLUG_PREFIX}ecologie` },
];

const links = (name: string) => [
  { label: "Instagram", url: `https://example.com/instagram/${name}` },
  { label: "SoundCloud", url: `https://example.com/soundcloud/${name}` },
];

export const EXAMPLE_ARTISTS: ExampleArtist[] = [
  {
    ref: "eloise",
    slug: "exemple-eloise-vachon",
    name: "Éloïse Vachon (exemple)",
    role: "resident",
    status: "published",
    photo: "portrait-eloise-vachon",
    links: links("eloise-vachon"),
    bio: "Résidente inventée pour l'exemple. Elle mixe de la **house** le dimanche et anime un podcast sur l'écologie au quotidien.",
    tags: ["dj", "podcast"],
  },
  {
    ref: "bastien",
    slug: "exemple-bastien-ocre",
    name: "Bastien Ocre (exemple)",
    role: "resident",
    status: "published",
    photo: "portrait-bastien-ocre",
    links: links("bastien-ocre"),
    bio: "Résident inventé pour l'exemple : techno de minuit et longues transitions.",
    tags: ["dj"],
  },
  {
    ref: "collectif",
    slug: "exemple-collectif-goutte-d-or",
    name: "Collectif Goutte d'Or (exemple)",
    role: "resident",
    status: "published",
    bio: "Collectif inventé pour l'exemple : des voix et des musiques du quartier.",
    tags: ["podcast", "playlist"],
  },
  { ref: "yaya", slug: "exemple-yaya-kossi", name: "Yaya Kossi (exemple)", role: "guest", status: "published", bio: "Invitée inventée pour l'exemple.", tags: ["dj"] },
  {
    ref: "zelie",
    slug: "exemple-zelie-marteau",
    name: "Zélie Marteau (exemple)",
    role: "guest",
    status: "published",
    bio: "Invitée inventée pour l'exemple, entre ambient et jazz.",
    tags: ["playlist"],
  },
  { ref: "crew", slug: "exemple-404-crew", name: "404 Crew (exemple)", role: "guest", status: "published", bio: "Équipe inventée pour l'exemple.", tags: ["dj"] },
  // Un nom fait de mots vides : la recherche le trouve quand même.
  { ref: "ellelui", slug: "exemple-elle-et-lui", name: "Elle & Lui (exemple)", role: "guest", status: "published", bio: "Duo inventé pour l'exemple." },
  {
    ref: "ana",
    slug: "exemple-ana-brouillon",
    name: "Ana Brouillon (exemple)",
    role: "guest",
    status: "draft",
    photo: "portrait-ana-brouillon",
    bio: "Fiche en brouillon : invisible sur le site.",
    tags: ["dj"],
  },
];

const hopper = (name: string) => `https://hppr.fr/exemple-${name}`;

export const EXAMPLE_SHOWS: ExampleShow[] = [
  {
    slug: "exemple-dimanche-house-a-la-chapelle",
    title: "Dimanche house à la Chapelle (exemple)",
    type: "dj_set",
    status: "published",
    day: -3,
    minutes: 120,
    description: "Un DJ set inventé pour l'exemple : deux heures de house et de musiques électroniques pour finir le week-end.",
    cover: "pochette-dimanche-house",
    soundcloud: "1000000001",
    energy: 4,
    artists: ["eloise"],
    tags: ["house", "deep-house"],
    tracks: [
      { artist: "Orchestre Imaginaire", title: "Lumière de Barbès", at: "0:00", hopper: hopper("lumiere-de-barbes") },
      { artist: "Les Fictifs", title: "Boulevard de la Chapelle", at: "6:12" },
      { artist: "DJ Inventée", title: "Marché Dejean", at: "11:40", hopper: hopper("marche-dejean") },
      { artist: "Orchestre Imaginaire", title: "Dimanche soir", at: "18:05" },
      { artist: "Nuit Blanche Fictive", title: "Dernier métro", at: "1:52:30" },
    ],
  },
  {
    slug: "exemple-techno-de-minuit",
    title: "Techno de minuit (exemple)",
    type: "dj_set",
    status: "published",
    day: -10,
    minutes: 90,
    description: "Un b2b inventé pour l'exemple, techno sombre et rapide.",
    cover: "pochette-techno-de-minuit",
    soundcloud: "1000000002",
    energy: 5,
    artists: ["bastien", "yaya"],
    tags: ["techno", "detroit-techno"],
    tracks: [
      { artist: "Machine Fictive", title: "Minuit pile", at: "0:00" },
      { artist: "Les Fictifs", title: "Tunnel", at: "7:30", hopper: hopper("tunnel") },
      { artist: "Machine Fictive", title: "Accélération", at: "15:00" },
      { artist: "Échos Inventés", title: "Sortie de secours", at: "1:20:00" },
    ],
  },
  {
    slug: "exemple-matin-calme",
    title: "Matin calme (exemple)",
    type: "playlist",
    status: "published",
    day: -5,
    minutes: 60,
    description: "Une playlist inventée pour l'exemple, pour se réveiller doucement.",
    cover: "pochette-matin-calme",
    soundcloud: "1000000003",
    energy: 1,
    artists: ["zelie"],
    tags: ["ambient"],
    tracks: [
      { artist: "Brume Fictive", title: "Rosée", at: "0:00" },
      { artist: "Échos Inventés", title: "Toits de Paris", at: "9:10" },
      { artist: "Brume Fictive", title: "Café noir", at: "21:45" },
    ],
  },
  {
    slug: "exemple-jazz-du-marche-dejean",
    title: "Jazz du marché Dejean (exemple)",
    type: "playlist",
    status: "published",
    day: -20,
    minutes: 75,
    description: "Une playlist inventée pour l'exemple : du jazz pour les après-midi pluvieux.",
    energy: 2,
    artists: ["collectif"],
    tags: ["jazz"],
    tracks: [
      { artist: "Quartet Imaginaire", title: "Pluie sur Château Rouge", at: "0:00" },
      { artist: "Trio Fictif", title: "Ballade du 18e", at: "8:20" },
      { artist: "Quartet Imaginaire", title: "Rue Myrha", at: "16:00" },
    ],
  },
  {
    slug: "exemple-voix-de-la-goutte-d-or",
    title: "Voix de la Goutte d'Or (exemple)",
    type: "podcast",
    status: "published",
    day: -15,
    minutes: 45,
    description: "Un podcast inventé pour l'exemple : les habitantes et les habitants racontent l'histoire du quartier.",
    artists: ["collectif"],
    tags: ["diasporas", "exemple-quartier"],
  },
  {
    slug: "exemple-ecologie-au-quotidien",
    title: "Écologie au quotidien (exemple)",
    type: "podcast",
    status: "published",
    day: -30,
    minutes: 40,
    description: "Un podcast inventé pour l'exemple : jardins partagés, réparation et vélo dans le 18e.",
    artists: ["eloise", "zelie"],
    tags: ["militantisme", "exemple-ecologie"],
  },
  {
    slug: "exemple-carte-blanche",
    title: "Carte blanche (exemple)",
    type: "dj_set",
    status: "published",
    day: -2,
    minutes: 60,
    description: "Un DJ set inventé pour l'exemple, avec une invitée dont la fiche est encore en brouillon.",
    energy: 4,
    artists: ["yaya", "ana"],
    tags: ["techno", "amapiano"],
  },
  {
    slug: "exemple-session-a-venir",
    title: "Session à venir (exemple)",
    type: "dj_set",
    status: "published",
    day: 4,
    minutes: 120,
    description: "Un show inventé pour l'exemple, annoncé avant sa diffusion : pas encore de son.",
    artists: ["crew"],
    tags: ["house"],
  },
  {
    slug: "exemple-set-non-publie",
    title: "Set non publié (exemple)",
    type: "dj_set",
    status: "draft",
    day: -1,
    minutes: 60,
    description: "Un brouillon inventé pour l'exemple : invisible sur le site, comme sa pochette et sa tracklist.",
    cover: "pochette-brouillon",
    artists: ["ana"],
    tags: ["techno"],
    tracks: [{ artist: "Artiste Secret", title: "Morceau confidentiel", at: "0:00" }],
  },
];

export const EXAMPLE_EVENTS: ExampleEvent[] = [
  {
    slug: "exemple-nuit-parabole",
    title: "Nuit Parabole (exemple)",
    tags: ["fete"],
    status: "published",
    startsIn: 7 * 24 + 8,
    hours: 6,
    venue: "Salle des fêtes imaginaire",
    address: "1 rue de l'Exemple, 75018 Paris",
    description: "Une soirée inventée pour l'exemple, avec les résidentes et résidents de la radio.",
    visual: "visuel-nuit-parabole",
    ticketUrl: "https://example.com/billetterie/nuit-parabole",
    artists: ["eloise", "bastien"],
  },
  {
    slug: "exemple-rencontre-radios-de-quartier",
    title: "Rencontre : radios de quartier (exemple)",
    tags: ["rencontre-talk"],
    status: "published",
    startsIn: 14 * 24 + 6,
    venue: "Bibliothèque imaginaire",
    description: "Une rencontre inventée pour l'exemple, sur les radios associatives et communautaires.",
    artists: ["collectif"],
  },
  {
    // Commencé il y a deux heures, sans heure de fin : encore « à venir » jusqu'à minuit (heure de Paris).
    slug: "exemple-atelier-du-jour",
    title: "Atelier du jour (exemple)",
    tags: ["live-session-art-ensemble"],
    status: "published",
    startsIn: -2,
    sameDay: true,
    venue: "Atelier imaginaire",
    description: "Un atelier inventé pour l'exemple : fabriquer une antenne parabolique en carton.",
    artists: [],
  },
  {
    slug: "exemple-expo-sonore",
    title: "Expo sonore (exemple)",
    tags: ["live-session-art-ensemble"],
    status: "published",
    startsIn: -40 * 24,
    hours: 10 * 24,
    venue: "Galerie imaginaire",
    description: "Une exposition inventée pour l'exemple : des haut-parleurs, des casques et des sons du quartier.",
    visual: "visuel-expo-sonore",
    artists: ["zelie"],
    photos: [
      { ref: "galerie-expo-2", caption: "Le coin d'écoute" },
      { ref: "galerie-expo-1", caption: "Le vernissage" },
      { ref: "galerie-expo-3" },
    ],
  },
  {
    slug: "exemple-soiree-speciale-anniversaire",
    title: "Soirée spéciale anniversaire (exemple)",
    tags: ["evenement-special", "fete"],
    status: "published",
    startsIn: -60 * 24,
    hours: 6,
    venue: "Salle des fêtes imaginaire",
    description: "Une fête inventée pour l'exemple : les un an de la radio.",
    artists: ["bastien", "yaya", "ana"],
    photos: [{ ref: "galerie-anniversaire-1" }, { ref: "galerie-anniversaire-2", caption: "Le gâteau" }],
  },
  {
    slug: "exemple-talk-ecologie-sonore",
    title: "Talk : écologie sonore (exemple)",
    tags: ["rencontre-talk"],
    status: "published",
    startsIn: -5 * 24,
    venue: "Bibliothèque imaginaire",
    description: "Une discussion inventée pour l'exemple, sur le bruit et le silence en ville.",
    artists: ["eloise"],
  },
  {
    slug: "exemple-evenement-brouillon",
    title: "Événement en brouillon (exemple)",
    tags: ["fete"],
    status: "draft",
    startsIn: 20 * 24,
    description: "Un brouillon inventé pour l'exemple : invisible sur le site.",
    artists: ["eloise"],
  },
];

export const EXAMPLE_PAGES = [
  {
    slug: "exemple-a-propos",
    title: "À propos (exemple)",
    status: "published" as const,
    body: "**Texte d'exemple.** Parabole Radio est une webradio communautaire du 18e arrondissement de Paris.\n\nCe texte sera remplacé par le vrai, saisi dans l'admin.",
  },
  { slug: "exemple-page-brouillon", title: "Page en brouillon (exemple)", status: "draft" as const, body: "Invisible sur le site." },
];

/** « 1:52:30 » ou « 6:12 » en secondes. */
function seconds(at: string): number {
  return at.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** Retire tous les exemples, et seulement eux. Les liens (tracklists, galeries…) partent avec leurs contenus. */
export async function removeExamples(db: Db): Promise<void> {
  const prefix = `${EXAMPLE_SLUG_PREFIX}%`;
  await db.transaction(async (tx) => {
    await tx.delete(show).where(like(show.slug, prefix));
    await tx.delete(event).where(like(event.slug, prefix));
    await tx.delete(artist).where(like(artist.slug, prefix));
    await tx.delete(page).where(like(page.slug, prefix));
    await tx.delete(tag).where(like(tag.slug, prefix));
    await tx.delete(media).where(like(media.key, `${EXAMPLE_MEDIA_PREFIX}%`));
  });
}

export type SeedSummary = { media: number; tags: number; artists: number; shows: number; tracks: number; events: number; pages: number };

/** Remplace les exemples par un jeu neuf, daté à partir de `now`. Rejouable : le reste de la base n'est pas touché. */
export async function seedExamples(db: Db, { now = new Date() }: { now?: Date } = {}): Promise<SeedSummary> {
  await removeExamples(db);
  const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
  return db.transaction(async (tx) => {
    const files = await tx
      .insert(media)
      .values(
        EXAMPLE_MEDIA.map((file) => ({
          key: file.key,
          mimeType: "image/webp",
          width: file.width,
          height: file.height,
          alt: file.alt,
          credit: file.credit,
          variants: file.variants ?? [],
        })),
      )
      .returning({ id: media.id, key: media.key });
    const fileId = (ref: string) => files.find((file) => file.key === `${EXAMPLE_MEDIA_PREFIX}${ref}.webp`)!.id;

    const tags = await tx.insert(tag).values(EXAMPLE_TAGS).returning({ id: tag.id });
    // Les étiquettes par adresse : celles d'exemple, et les vraies des filtres.
    const tagIds = new Map((await tx.select({ id: tag.id, slug: tag.slug }).from(tag)).map((row) => [row.slug, row.id]));
    const tagged = (slugs: string[] | undefined) => (slugs ?? []).flatMap((slug) => (tagIds.has(slug) ? [tagIds.get(slug)!] : []));

    const artists = await tx
      .insert(artist)
      .values(
        EXAMPLE_ARTISTS.map((example) => ({
          slug: example.slug,
          name: example.name,
          role: example.role,
          status: example.status,
          bio: example.bio,
          photoId: example.photo ? fileId(example.photo) : undefined,
          links: example.links ?? [],
        })),
      )
      .returning({ id: artist.id, slug: artist.slug });
    const artistId = (ref: string) => artists.find((row) => row.slug === EXAMPLE_ARTISTS.find((example) => example.ref === ref)!.slug)!.id;
    const artistTags = EXAMPLE_ARTISTS.flatMap((example) => tagged(example.tags).map((tagId) => ({ artistId: artistId(example.ref), tagId })));
    if (artistTags.length) await tx.insert(artistTag).values(artistTags);

    let tracks = 0;
    for (const example of EXAMPLE_SHOWS) {
      const [row] = await tx
        .insert(show)
        .values({
          slug: example.slug,
          title: example.title,
          type: example.type,
          status: example.status,
          broadcastAt: at(example.day * 24),
          durationSeconds: example.minutes ? example.minutes * 60 : undefined,
          energy: example.energy,
          description: example.description,
          coverId: example.cover ? fileId(example.cover) : undefined,
          soundcloudUrl: example.soundcloud ? `https://soundcloud.com/parabole-radio/${example.slug}` : undefined,
          soundcloudTrackId: example.soundcloud,
        })
        .returning({ id: show.id });
      const id = row!.id;
      if (example.artists.length) await tx.insert(showArtist).values(example.artists.map((ref, position) => ({ showId: id, artistId: artistId(ref), position })));
      const showTags = tagged(example.tags);
      if (showTags.length) await tx.insert(showTag).values(showTags.map((tagId) => ({ showId: id, tagId })));
      if (example.tracks?.length) {
        await tx.insert(track).values(
          example.tracks.map((item, index) => ({
            showId: id,
            position: index + 1,
            artist: item.artist,
            title: item.title,
            startSeconds: item.at ? seconds(item.at) : undefined,
            hopperUrl: item.hopper,
          })),
        );
        tracks += example.tracks.length;
      }
    }

    for (const example of EXAMPLE_EVENTS) {
      const startsAt = new Date(Math.max(at(example.startsIn).getTime(), example.sameDay ? startOfParisDay(now).getTime() : -Infinity));
      const [row] = await tx
        .insert(event)
        .values({
          slug: example.slug,
          title: example.title,
          status: example.status,
          startsAt,
          endsAt: example.hours ? new Date(startsAt.getTime() + example.hours * HOUR) : undefined,
          venue: example.venue,
          address: example.address,
          description: example.description,
          visualId: example.visual ? fileId(example.visual) : undefined,
          ticketUrl: example.ticketUrl,
        })
        .returning({ id: event.id });
      const id = row!.id;
      if (example.artists.length) await tx.insert(eventArtist).values(example.artists.map((ref, position) => ({ eventId: id, artistId: artistId(ref), position })));
      const eventTags = tagged(example.tags);
      if (eventTags.length) await tx.insert(eventTag).values(eventTags.map((tagId) => ({ eventId: id, tagId })));
      if (example.photos?.length) {
        await tx.insert(eventPhoto).values(example.photos.map((photo, position) => ({ eventId: id, mediaId: fileId(photo.ref), position, caption: photo.caption })));
      }
    }

    await tx.insert(page).values(EXAMPLE_PAGES);

    return {
      media: files.length,
      tags: tags.length,
      artists: artists.length,
      shows: EXAMPLE_SHOWS.length,
      tracks,
      events: EXAMPLE_EVENTS.length,
      pages: EXAMPLE_PAGES.length,
    };
  });
}

/** Combien d'exemples la base contient, par table (0 partout après removeExamples). */
export async function countExamples(db: Db): Promise<Record<string, number>> {
  const prefix = `${EXAMPLE_SLUG_PREFIX}%`;
  const count = sql<number>`count(*)`.mapWith(Number);
  const [shows] = await db.select({ n: count }).from(show).where(like(show.slug, prefix));
  const [artists] = await db.select({ n: count }).from(artist).where(like(artist.slug, prefix));
  const [events] = await db.select({ n: count }).from(event).where(like(event.slug, prefix));
  const [pages] = await db.select({ n: count }).from(page).where(like(page.slug, prefix));
  const [tags] = await db.select({ n: count }).from(tag).where(like(tag.slug, prefix));
  const [files] = await db.select({ n: count }).from(media).where(like(media.key, `${EXAMPLE_MEDIA_PREFIX}%`));
  return { shows: shows!.n, artists: artists!.n, events: events!.n, pages: pages!.n, tags: tags!.n, media: files!.n };
}
