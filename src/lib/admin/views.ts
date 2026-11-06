/**
 * Les données des écrans de l'application d'admin, préparées par le serveur (src/components/admin/types.ts) : la
 * personne connectée, une fiche de show, d'artiste ou d'événement avec ce qu'il faut pour la remplir, et les réponses
 * en JSON. Les
 * dates partent déjà écrites à l'heure de Paris.
 */
import {
  compteSoundCloud,
  dayLabel,
  DELAY_CHOICES,
  emptyArtistForm,
  emptyEventForm,
  emptyShowForm,
  formatTimecode,
  mediaUrl,
  MUTE_CHOICES,
  SLOW_CHOICES,
  STUCK_SENDING_MS,
  type AdminAbout,
  type Admin,
  type AdminApplication,
  type AdminApplicationRow,
  type AdminAntenne,
  type AdminArtist,
  type AdminUploadLink,
  type AdminChatMessage,
  type AdminClip,
  type AdminEvent,
  type AdminEventPhoto,
  type AdminFilm,
  type AdminMedia,
  type AdminShow,
  type TeamMember,
  type Taxonomy,
} from "@parabole/cms";
import {
  UNPLACED,
  type AboutSheet,
  type AntenneData,
  type ApplicationRow,
  type ApplicationSheet,
  type ArtistSheet,
  type DashboardData,
  type ChatMessageRow,
  type ClipsData,
  type EnvoiView,
  type EventSheet,
  type GalleryPhoto,
  type FilmView,
  type MediaView,
  type ShowSheet,
  type TagsData,
  type UploadLinkView,
  type Viewer,
} from "../../components/admin/types";
import { isRubrique, MOOD_TAB, SCOPE_OF_RUBRIQUE } from "../../components/admin/rubriques";
import { database, mediaBaseUrl } from "../cms";
import { soundcloudReady } from "../soundcloud";
import { blobReady, MAX_FILM_BYTES, MAX_VIDEO_BYTES } from "./blob";
import { aboutFormOf, artistFormOf, eventFormOf, showFormOf } from "./forms";
import { inDays, megabytes, parisDateTime, parisDay, parisDayParts, parisLongDay, parisShortDay, parisTime, since } from "./format";
import { radiocultArtists, radiocultPanel } from "./imports";
import { MAX_IMAGE_BYTES, storageReady } from "./storage";
import { r2Ready } from "../r2";

export const viewerOf = (member: TeamMember): Viewer => ({ name: member.name, email: member.email, role: member.role });

/** Une image à montrer dans une fiche : ses adresses dans le seau « media », l'aperçu en version réduite (400 px). */
export function mediaView(file: AdminMedia | null): MediaView | null {
  if (!file) return null;
  const url = (key: string) => mediaUrl(mediaBaseUrl, key);
  return { id: file.id, url: url(file.key), thumb: url(file.variants[0]?.key ?? file.key), width: file.width, height: file.height, alt: file.alt, credit: file.credit };
}

/** L'envoi des images, pour les fiches. */
const uploads = () => ({ ready: storageReady(), maxBytes: MAX_IMAGE_BYTES });

/**
 * Une fiche de show à afficher (vide pour un nouveau show), avec les artistes et les étiquettes à proposer. Une
 * étiquette du show rangée seulement dans un filtre d'un autre contenu (Activité…) s'y ajoute, pour garder son nom.
 */
export async function showSheet(admin: Admin, show: AdminShow | null): Promise<ShowSheet> {
  const choices = await admin.showChoices();
  const known = new Set(choices.tags.map((tag) => tag.id));
  const others = (show?.tags ?? []).filter((tag) => !known.has(tag.id)).map((tag) => ({ ...tag, places: [] }));
  return {
    id: show?.id ?? null,
    status: show?.status ?? "draft",
    version: show?.version ?? "",
    created: show ? parisDateTime(show.createdAt) : null,
    updated: show ? parisDateTime(show.updatedAt) : null,
    form: show ? showFormOf(show) : emptyShowForm(),
    cover: mediaView(show?.cover ?? null),
    uploads: uploads(),
    radiocultEventId: show?.radiocultEventId ?? null,
    artists: choices.artists,
    tags: [...choices.tags, ...others],
    facets: choices.facets,
    envoi: show ? await envoiView(admin, show.id) : { submission: null, main: null, parts: [], candidates: [], ready: r2Ready(), soundcloud: soundcloudReady() ? "unlinked" : "off" },
  };
}

/**
 * Ce qu'un show a reçu d'un résident (cms/README.md, 9.12) : l'envoi, son son et ses morceaux, à écouter et à
 * télécharger par l'admin, et les créneaux où il peut aller s'il attend le sien.
 */
export async function envoiView(admin: Admin, showId: string): Promise<EnvoiView> {
  const [sent, files] = await Promise.all([admin.submissionOf(showId), admin.audioFilesOf(showId)]);
  const main = files.find((file) => file.role === "main");
  const [candidates, account] = await Promise.all([
    sent?.waiting ? admin.attachCandidates(showId) : [],
    // Le compte SoundCloud ne compte que pour un son à publier.
    main && soundcloudReady() ? database().then(compteSoundCloud).catch(() => null) : null,
  ]);
  const now = Date.now();
  const audio = (file: (typeof files)[number]) => ({
    id: file.id,
    fileName: file.fileName,
    size: file.sizeBytes ? megabytes(file.sizeBytes) : "",
    status: file.status,
    error: file.error,
    stalled: file.status === "sending" && now - file.updatedAt.getTime() > STUCK_SENDING_MS,
    listen: `/admin/api/son/${file.id}`,
    download: `/admin/api/son/${file.id}?telecharger`,
    artist: file.trackArtist ?? "",
    title: file.trackTitle ?? "",
    duration: file.durationSeconds ? formatTimecode(file.durationSeconds) : "",
    seconds: file.durationSeconds,
  });
  return {
    submission: sent
      ? {
          artist: sent.artist,
          sent: parisDateTime(sent.createdAt),
          // Modifié : par le résident (un nouveau fichier, une correction), ou par l'équipe (rattaché à son créneau).
          updated: sent.updatedAt.getTime() - sent.createdAt.getTime() > 60_000 ? parisDateTime(sent.updatedAt) : null,
          block: sent.blockStart ? `bloc du ${dayLabel(sent.blockStart, false)}` : null,
          week: sent.week === 1 ? "1re semaine" : sent.week === 2 ? "2e semaine" : null,
          late: sent.late,
          waiting: sent.waiting,
          note: sent.note,
          link: sent.link,
        }
      : null,
    main: main ? audio(main) : null,
    parts: files.filter((file) => file.role === "part").map(audio),
    candidates: candidates.map((slot) => ({ id: slot.id, title: slot.title, when: parisDateTime(slot.broadcastAt) })),
    ready: r2Ready(),
    soundcloud: !soundcloudReady() ? "off" : account ? "linked" : "unlinked",
  };
}

/** Le lien d'envoi d'un artiste, pour sa fiche : l'adresse est complétée par le navigateur (son origine). */
export const uploadLinkView = (link: AdminUploadLink | null): UploadLinkView | null =>
  link
    ? { path: `/envoyer/${link.token}`, created: parisDateTime(link.createdAt), used: link.usedAt ? parisDateTime(link.usedAt) : null, profile: link.profileUpdatedAt ? parisDateTime(link.profileUpdatedAt) : null }
    : null;

/**
 * Une fiche d'artiste à afficher (vide pour un nouvel artiste), avec ses shows, les étiquettes à cocher et les artistes
 * de Radio Cult à qui la relier.
 */
export async function artistSheet(admin: Admin, artist: AdminArtist | null): Promise<ArtistSheet> {
  const [choices, radiocult, links, uploadLink] = await Promise.all([admin.artistChoices(), radiocultArtists(), admin.radiocultLinks(), artist ? admin.uploadLinkOf(artist.id) : null]);
  const taken = Object.fromEntries([...links].filter(([, linked]) => linked.id !== artist?.id).map(([id, linked]) => [id, linked.name]));
  return {
    id: artist?.id ?? null,
    status: artist?.status ?? "draft",
    version: artist?.version ?? "",
    created: artist ? parisDateTime(artist.createdAt) : null,
    updated: artist ? parisDateTime(artist.updatedAt) : null,
    form: artist ? artistFormOf(artist) : emptyArtistForm(),
    photo: mediaView(artist?.photo ?? null),
    uploads: uploads(),
    radiocult: { choices: radiocult, taken },
    shows: (artist?.shows ?? []).map((show) => ({ id: show.id, title: show.title, type: show.type, status: show.status, date: show.broadcastAt ? parisDay(show.broadcastAt) : "sans date" })),
    events: artist?.events ?? 0,
    facets: choices.facets,
    tags: choices.tags,
    uploadLink: uploadLinkView(uploadLink),
  };
}

/** La galerie d'un événement, prête à montrer, dans l'ordre. */
export const galleryView = (photos: AdminEventPhoto[]): GalleryPhoto[] => photos.map((photo) => ({ image: mediaView(photo.media)!, caption: photo.caption ?? "" }));

/**
 * Une fiche d'événement à afficher (vide pour un nouvel événement), avec les artistes et les étiquettes à proposer.
 * Une étiquette de l'événement rangée seulement dans le filtre d'un autre contenu s'y ajoute, pour garder son nom.
 */
export async function eventSheet(admin: Admin, event: AdminEvent | null): Promise<EventSheet> {
  const choices = await admin.eventChoices();
  const known = new Set(choices.tags.map((tag) => tag.id));
  const others = (event?.tags ?? []).filter((tag) => !known.has(tag.id)).map((tag) => ({ ...tag, places: [] }));
  return {
    id: event?.id ?? null,
    status: event?.status ?? "draft",
    version: event?.version ?? "",
    created: event ? parisDateTime(event.createdAt) : null,
    updated: event ? parisDateTime(event.updatedAt) : null,
    form: event ? eventFormOf(event) : emptyEventForm(),
    visual: mediaView(event?.visual ?? null),
    photos: galleryView(event?.photos ?? []),
    uploads: uploads(),
    artists: choices.artists,
    tags: [...choices.tags, ...others],
    facets: choices.facets,
  };
}

/**
 * L'état de l'import Radio Cult, ou null si son journal n'existe pas encore dans la base (migrations 0012 et 0013 pas
 * appliquées, code 42P01 de Postgres) : l'accueil s'ouvre quand même et le dit.
 */
async function importStatusOf(admin: Admin) {
  try {
    return await admin.importStatus();
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === "42P01") return null;
    throw error;
  }
}

/** L'accueil : les prochaines diffusions, ce qui reste à compléter, les brouillons, les chiffres et l'import Radio Cult. */
export async function dashboardData(admin: Admin, now = new Date()): Promise<DashboardData> {
  const [overview, imports, cycle, account, applications] = await Promise.all([
    admin.overview({ now }),
    importStatusOf(admin),
    admin.cycle(),
    database().then(compteSoundCloud).catch(() => null),
    admin.applicationCounts(now),
  ]);
  return {
    today: parisLongDay(now),
    stats: { shows: overview.shows, artists: overview.artists },
    upcoming: overview.upcoming.map((show) => ({
      href: `/admin/shows/${show.id}`,
      title: show.title,
      artists: show.artists.join(", "),
      type: show.type,
      status: show.status,
      ...parisDayParts(show.broadcastAt),
      time: parisTime(show.broadcastAt),
      when: inDays(show.broadcastAt, now),
    })),
    missing: overview.missing,
    envois: overview.envois,
    applications,
    deadlines: overview.deadlines.map((panel) => ({
      group: panel.block.group,
      block: `du ${dayLabel(panel.block.start)} au ${dayLabel(panel.block.end)}`,
      deadline: dayLabel(panel.block.deadline),
      when: inDays(panel.deadline, now),
      late: panel.late,
      sent: panel.residents.filter((resident) => resident.sent).length,
      residents: panel.residents.map((resident) => ({ id: resident.id, name: resident.name, sent: resident.sent, link: resident.token ? `/envoyer/${resident.token}` : null })),
    })),
    cycle: cycle ? { group1Start: cycle.group1Start, blockDays: cycle.blockDays, deadlineDays: cycle.deadlineDays } : null,
    soundcloud: { ready: soundcloudReady(), account: account ? { username: account.username, url: account.permalinkUrl, since: parisDay(account.linkedAt) } : null },
    drafts: overview.drafts.map((draft) => ({
      href: `/admin/${draft.kind === "show" ? "shows" : "artistes"}/${draft.id}`,
      title: draft.title,
      kind: draft.kind,
      since: since(draft.updatedAt, now),
    })),
    radiocult: radiocultPanel(imports, now),
  };
}

/**
 * Les étiquettes et les filtres, et l'onglet à montrer : celui demandé s'il existe (un filtre, le mood, « à classer »),
 * sinon le premier filtre de la rubrique demandée (?rubrique=residents, rubriques.ts), sinon le tout premier. Une
 * rubrique encore sans filtre s'ouvre sur elle-même (les émissions, sur le mood).
 */
export function tagsData(taxonomy: Taxonomy, wanted: string | null, rubrique: string | null = null): TagsData {
  if (wanted === UNPLACED || wanted === MOOD_TAB || taxonomy.facets.some((facet) => facet.slug === wanted)) return { ...taxonomy, current: wanted! };
  const asked = isRubrique(rubrique) ? rubrique : isRubrique(wanted) ? wanted : null;
  if (asked) {
    const first = taxonomy.facets.find((facet) => facet.scope === SCOPE_OF_RUBRIQUE[asked]);
    return { ...taxonomy, current: first?.slug ?? (asked === "emissions" ? MOOD_TAB : asked) };
  }
  return { ...taxonomy, current: taxonomy.facets[0]?.slug ?? UNPLACED };
}

/** Les vidéos de fond, dans l'ordre : le numéro de chaîne compte celles de la rotation. */
export function clipsData(clips: AdminClip[]): ClipsData {
  let channel = 0;
  return {
    uploads: blobReady(),
    maxBytes: MAX_VIDEO_BYTES,
    clips: clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      videoUrl: clip.videoUrl,
      posterUrl: clip.posterUrl,
      channel: clip.status === "published" ? ++channel : null,
      status: clip.status,
      origin: clip.videoUrl.startsWith("/") ? "site" : "upload",
      facts: [
        clip.durationSeconds && formatTimecode(clip.durationSeconds),
        clip.width && clip.height && `${clip.width} × ${clip.height}`,
        clip.sizeBytes && megabytes(clip.sizeBytes),
      ]
        .filter(Boolean)
        .join(" · "),
      added: parisDay(clip.createdAt),
    })),
  };
}

/** Le film de la page À propos, prêt à montrer. */
export function filmView(film: AdminFilm | null): FilmView | null {
  if (!film) return null;
  return {
    url: film.videoUrl,
    poster: film.posterUrl,
    width: film.width,
    height: film.height,
    facts: [film.durationSeconds && formatTimecode(film.durationSeconds), film.width && film.height && `${film.width} × ${film.height}`, film.sizeBytes && megabytes(film.sizeBytes)]
      .filter(Boolean)
      .join(" · "),
  };
}

/** La page À propos à remplir, avec son film. */
export const aboutSheet = (about: AdminAbout): AboutSheet => ({
  version: about.version,
  updated: parisDateTime(about.updatedAt),
  form: aboutFormOf(about),
  film: filmView(about.film),
  uploads: blobReady(),
  maxBytes: MAX_FILM_BYTES,
});

/** « 21:42 » aujourd'hui, « lun. 2 nov., 21:42 » avant. */
const whenOf = (at: Date, now: Date) => (parisDay(at) === parisDay(now) ? parisTime(at) : `${parisShortDay(at)}, ${parisTime(at)}`);

/**
 * L'antenne libre, vue par la régie : les heures écrites à l'heure de Paris ; l'heure de passage et l'heure du serveur
 * en millisecondes, pour le compte à rebours d'un message en différé.
 */
export function antenneData(antenne: AdminAntenne, now = new Date()): AntenneData {
  const row = (message: AdminChatMessage): ChatMessageRow => ({
    id: message.id,
    pseudo: message.pseudo,
    color: message.color,
    body: message.body,
    status: message.status,
    reason: message.reason,
    decidedBy: message.decidedBy,
    team: message.team,
    authorId: message.authorId,
    time: whenOf(message.createdAt, now),
    onAir: message.onAirAt.getTime(),
    reports: message.reports,
    first: message.first,
  });
  const { clearedAt, ...settings } = antenne.settings;
  return {
    now: now.getTime(),
    // Les choix permis viennent du CMS, qui les vérifie à l'enregistrement : l'écran ne les recopie pas.
    choices: { slow: [...SLOW_CHOICES], delay: [...DELAY_CHOICES], mute: [...MUTE_CHOICES] },
    settings: { ...settings, cleared: clearedAt ? parisDateTime(clearedAt) : null },
    messages: antenne.messages.map(row),
    held: antenne.held.map(row),
    reported: antenne.reported.map(row),
    people: antenne.people.map((person) => ({
      id: person.id,
      pseudo: person.pseudo,
      color: person.color,
      mutedUntil: person.mutedUntil && person.mutedUntil > now ? whenOf(person.mutedUntil, now) : null,
      banned: person.bannedAt !== null,
      bannedOn: person.bannedAt ? parisDateTime(person.bannedAt) : null,
      bannedReason: person.bannedReason,
      lastSeen: since(person.lastSeenAt, now),
    })),
    terms: antenne.terms,
  };
}

/** L'application demande un écran ou envoie une fiche (fetch) : elle attend du JSON, pas une page. */
export const wantsJson = (request: Request) => (request.headers.get("accept") ?? "").includes("application/json");

/** Une réponse JSON de l'admin. */
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// ---------------------------------------------------------------------------------------------------------------
// Les candidatures (cms/README.md, 9.17)
// ---------------------------------------------------------------------------------------------------------------

/** Le compte Instagram (« @nom ») ou l'adresse e-mail : de quoi répondre. */
const contactOf = (row: Pick<AdminApplicationRow, "instagram" | "email">) => (row.instagram ? `@${row.instagram}` : (row.email ?? ""));

/** Une candidature dans la liste. */
export function applicationRow(row: AdminApplicationRow, now = new Date()): ApplicationRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    ready: row.ready,
    regular: row.regular,
    city: row.city,
    contact: contactOf(row),
    status: row.status,
    received: since(row.createdAt, now),
    receivedAt: parisDateTime(row.createdAt),
    late: row.late,
  };
}

/** Une candidature ouverte, prête à montrer. */
export function applicationSheet(application: AdminApplication, replyDays: number, now = new Date()): ApplicationSheet {
  return {
    id: application.id,
    name: application.name,
    type: application.type,
    ready: application.ready,
    regular: application.regular,
    city: application.city,
    instagram: application.instagram,
    email: application.email,
    status: application.status,
    receivedAt: parisDateTime(application.createdAt),
    received: since(application.createdAt, now),
    late: application.late,
    pitch: application.pitch,
    listenUrl: application.listenUrl,
    note: application.note ?? "",
    styles: application.styles.map((style) => style.name),
    artist: application.artist
      ? { id: application.artist.id, name: application.artist.name, status: application.artist.status, link: application.artist.token ? `/envoyer/${application.artist.token}` : null }
      : null,
    answeredBy: application.answeredBy,
    answeredAt: application.answeredAt ? parisDateTime(application.answeredAt) : null,
    erasedAt: application.erasedAt ? parisDay(application.erasedAt) : null,
    sameName: application.sameName,
    replyDays,
  };
}
