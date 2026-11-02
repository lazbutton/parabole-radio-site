/**
 * Les données des écrans de l'application d'admin, préparées par le serveur (src/components/admin/types.ts) : la
 * personne connectée, une fiche de show ou d'artiste avec ce qu'il faut pour la remplir, et les réponses en JSON. Les
 * dates partent déjà écrites à l'heure de Paris.
 */
import {
  DELAY_CHOICES,
  emptyArtistForm,
  emptyShowForm,
  formatTimecode,
  mediaUrl,
  MUTE_CHOICES,
  SLOW_CHOICES,
  type Admin,
  type AdminAntenne,
  type AdminArtist,
  type AdminChatMessage,
  type AdminClip,
  type AdminMedia,
  type AdminShow,
  type TeamMember,
  type Taxonomy,
} from "@parabole/cms";
import {
  UNPLACED,
  type AntenneData,
  type ArtistSheet,
  type ChatMessageRow,
  type ClipsData,
  type MediaView,
  type ShowSheet,
  type TagsData,
  type Viewer,
} from "../../components/admin/types";
import { mediaBaseUrl } from "../cms";
import { blobReady, MAX_VIDEO_BYTES } from "./blob";
import { artistFormOf, showFormOf } from "./forms";
import { megabytes, parisDateTime, parisDay, parisShortDay, parisTime, since } from "./format";
import { MAX_IMAGE_BYTES, storageReady } from "./storage";

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
  };
}

/** Une fiche d'artiste à afficher (vide pour un nouvel artiste), avec ses shows et les étiquettes à cocher. */
export async function artistSheet(admin: Admin, artist: AdminArtist | null): Promise<ArtistSheet> {
  const choices = await admin.artistChoices();
  return {
    id: artist?.id ?? null,
    status: artist?.status ?? "draft",
    version: artist?.version ?? "",
    created: artist ? parisDateTime(artist.createdAt) : null,
    updated: artist ? parisDateTime(artist.updatedAt) : null,
    form: artist ? artistFormOf(artist) : emptyArtistForm(),
    photo: mediaView(artist?.photo ?? null),
    uploads: uploads(),
    radiocultArtistId: artist?.radiocultArtistId ?? null,
    shows: (artist?.shows ?? []).map((show) => ({ id: show.id, title: show.title, type: show.type, status: show.status, date: show.broadcastAt ? parisDay(show.broadcastAt) : "sans date" })),
    events: artist?.events ?? 0,
    facets: choices.facets,
    tags: choices.tags,
  };
}

/** Les étiquettes et les filtres, et l'onglet à montrer : celui demandé s'il existe, sinon le premier filtre. */
export function tagsData(taxonomy: Taxonomy, wanted: string | null): TagsData {
  const current = wanted === UNPLACED || taxonomy.facets.some((facet) => facet.slug === wanted) ? wanted! : (taxonomy.facets[0]?.slug ?? UNPLACED);
  return { ...taxonomy, current };
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
