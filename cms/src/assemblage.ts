/**
 * L'assemblage d'une playlist (cms/README.md, 9.13) : le calcul, sans le son. Rien que des nombres et du texte : ce
 * module sert dans le navigateur (@parabole/cms/assemblage), où l'outil de l'admin décode, enchaîne et encode les
 * morceaux, comme sur le serveur et dans les tests.
 *
 *   - la frise : où commence chaque morceau, et la durée de chaque fondu enchaîné, raccourci pour un morceau court ;
 *   - les gains d'un fondu, à puissance constante (le volume ne creuse pas au milieu) ;
 *   - les silences du début et de la fin d'un morceau ;
 *   - la setlist minutée qui en sort ;
 *   - le rapprochement des fichiers glissés par l'équipe avec la liste d'une playlist : chaque fichier à sa place,
 *     malgré les accents, « feat. », les mentions de version et les numéros, la durée départageant deux candidats ;
 *   - la lecture des réponses de Deezer, YouTube et SoundCloud. Spotify n'en fait plus partie : depuis février 2026, une
 *     appli en mode développement ne lit que les playlists de son propriétaire ; on colle alors la liste.
 */
import { formatTimecode, type TrackLine } from "./tracklist.ts";

/** Le fondu enchaîné proposé, et le plus long permis, en secondes. */
export const DEFAULT_FADE = 3;
export const MAX_FADE = 10;
/** Un silence : sous −60 dB sur tous les canaux. On en retire 5 s au plus, au début comme à la fin. */
export const SILENCE_DB = -60;
export const MAX_SILENCE = 5;
/** La fréquence du fichier assemblé : celle du MP3 que prend Radio Cult. */
export const SAMPLE_RATE = 44_100;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// ---------------------------------------------------------------------------------------------------------------
// La frise
// ---------------------------------------------------------------------------------------------------------------

/** Le fondu enchaîné entre deux morceaux : le réglage, sans dépasser la moitié de l'un ni de l'autre. */
export function crossfade(fade: number, before: number, after: number): number {
  return Math.max(0, Math.min(fade, before / 2, after / 2));
}

/** Un morceau dans le fichier assemblé : son départ, sa durée jouée (silences retirés), ses deux fondus. */
export type Slot = { start: number; length: number; fadeIn: number; fadeOut: number };

/**
 * La frise d'une playlist : chaque morceau part quand le précédent commence à s'effacer. Le départ d'un morceau vaut la
 * somme des durées précédentes, moins les fondus. Rend aussi la durée totale.
 */
export function timeline(lengths: number[], fade: number): { slots: Slot[]; total: number } {
  const slots: Slot[] = [];
  let start = 0;
  lengths.forEach((length, index) => {
    const fadeIn = index > 0 ? crossfade(fade, lengths[index - 1]!, length) : 0;
    const fadeOut = index < lengths.length - 1 ? crossfade(fade, length, lengths[index + 1]!) : 0;
    start -= fadeIn;
    slots.push({ start, length, fadeIn, fadeOut });
    start += length;
  });
  return { slots, total: Math.max(0, start) };
}

/** Le gain du morceau qui arrive, `progress` allant de 0 (début du fondu) à 1 (fin) : à puissance constante. */
export const fadeInGain = (progress: number) => Math.sin((clamp01(progress) * Math.PI) / 2);
/** Le gain du morceau qui s'en va. Les deux gains au carré font toujours 1. */
export const fadeOutGain = (progress: number) => Math.cos((clamp01(progress) * Math.PI) / 2);

// ---------------------------------------------------------------------------------------------------------------
// Les silences
// ---------------------------------------------------------------------------------------------------------------

/**
 * Les silences d'un morceau, en échantillons, au début et à la fin : tant que le son reste sous le seuil sur tous les
 * canaux, `max` secondes au plus de chaque côté. Un morceau tout entier silencieux n'est pas touché.
 */
export function silences(channels: Float32Array[], sampleRate: number, { db = SILENCE_DB, max = MAX_SILENCE }: { db?: number; max?: number } = {}): { start: number; end: number } {
  const length = channels[0]?.length ?? 0;
  if (!length) return { start: 0, end: 0 };
  const threshold = 10 ** (db / 20);
  const limit = Math.min(Math.floor(max * sampleRate), length);
  const loud = (index: number) => channels.some((channel) => Math.abs(channel[index]!) > threshold);
  let start = 0;
  while (start < limit && !loud(start)) start++;
  let end = 0;
  while (end < limit && !loud(length - 1 - end)) end++;
  return start + end >= length ? { start: 0, end: 0 } : { start, end };
}

// ---------------------------------------------------------------------------------------------------------------
// La setlist
// ---------------------------------------------------------------------------------------------------------------

/** La setlist minutée : chaque morceau à son départ dans le fichier assemblé, à la seconde. */
export function setlist(tracks: { artist: string; title: string }[], slots: Slot[]): TrackLine[] {
  return tracks.map((track, index) => ({ start: formatTimecode(slots[index]?.start ?? 0), artist: track.artist.trim(), title: track.title.trim(), hopperUrl: "" }));
}

// ---------------------------------------------------------------------------------------------------------------
// Le rapprochement des fichiers avec la liste d'une playlist
// ---------------------------------------------------------------------------------------------------------------

/** Un morceau de la liste d'une playlist : lu sur sa plateforme, ou collé (parseTracklist). */
export type ListedTrack = { artist: string; title: string; duration: number | null };

/** Un fichier glissé dans l'outil : son nom, ce que ses étiquettes ou son nom disent, sa durée. */
export type DroppedFile = { id: string; name: string; artist?: string; title?: string; duration: number | null };

/** Ce que le rapprochement trouve : pour chaque morceau de la liste, son fichier (ou rien) ; les fichiers en trop. */
export type Matching = { places: (string | null)[]; missing: number[]; unknown: string[] };

/** Les mentions entre parenthèses ou crochets : « (Original Mix) », « [Remastered 2011] », « (feat. X) ». */
const BRACKETS = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
/** « feat. X », jusqu'au tiret suivant : « Artiste feat. Autre - Titre » garde son titre. */
const FEATURING = /\b(?:feat|ft|featuring)\b\.?[^-–—]*/gi;
/** Une mention de version en dernier segment : « Titre - Radio Edit », « Titre - 2011 Remaster ». */
const VERSION = /\b(?:remaster(?:ed)?|edit|mix|version|live|mono|stereo|bonus|demo|extended|instrumental)\b/i;
const DASH = /\s+[-–—]\s+/;

/**
 * Un texte ramené à ses mots : minuscules, sans accents, sans extension ni numéro de piste, sans mentions de version.
 * `segments` : à partir de combien de segments (séparés par « - ») le dernier peut n'être qu'une mention de version,
 * 2 pour un titre (« Titre - Radio Edit »), 3 pour un nom de fichier qui commence par l'artiste.
 */
export function words(input: string, segments = 2): string[] {
  let clean = input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\.(?:mp3|m4a|wav|wave|aif|aiff|flac)$/i, "")
    .replace(/^\s*\d{1,3}\s*[-–—.)]?\s+/, "")
    .replace(BRACKETS, " ")
    .replace(FEATURING, " ");
  const parts = clean.split(DASH);
  if (parts.length >= segments && parts.length > 1 && VERSION.test(parts.at(-1)!) && parts.at(-1)!.trim().split(/\s+/).length <= 4) clean = parts.slice(0, -1).join(" - ");
  return clean
    .replace(/&/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && !["the", "and", "et", "x", "vs"].includes(word));
}

/** La part des mots de `a` présents dans `b`, et le coefficient de Dice des deux. */
function overlap(a: string[], b: string[]): { cover: number; dice: number } {
  if (!a.length || !b.length) return { cover: 0, dice: 0 };
  const pool = new Set(b);
  const shared = a.filter((word) => pool.has(word)).length;
  return { cover: shared / a.length, dice: (2 * shared) / (a.length + new Set(b).size) };
}

/**
 * Range chaque fichier à sa place dans la liste. Un fichier va au morceau dont il porte le titre (au moins la moitié
 * de ses mots) et le plus de mots en commun ; à score voisin, la durée la plus proche l'emporte. Rend les morceaux
 * restés sans fichier (`missing`) et les fichiers restés sans place (`unknown`), à placer à la main.
 */
export function rapprocher(list: ListedTrack[], files: DroppedFile[]): Matching {
  const pairs: { track: number; file: number; score: number; gap: number }[] = [];
  list.forEach((track, t) => {
    const title = words(track.title);
    const full = [...words(track.artist), ...title];
    files.forEach((file, f) => {
      const tagged = file.title ? [...words(file.artist ?? ""), ...words(file.title)] : [];
      const named = words(file.name, 3);
      // Les étiquettes du fichier, sinon son nom : le meilleur des deux.
      const candidates = [tagged, named].filter((one) => one.length);
      let best = { cover: 0, dice: 0 };
      for (const candidate of candidates) {
        const titled = overlap(title, candidate);
        if (titled.cover < 0.5) continue;
        const both = overlap(full, candidate);
        if (both.dice > best.dice) best = { cover: titled.cover, dice: both.dice };
      }
      if (best.dice < 0.4) return;
      const gap = track.duration !== null && file.duration !== null ? Math.abs(track.duration - file.duration) : Number.POSITIVE_INFINITY;
      pairs.push({ track: t, file: f, score: best.dice, gap });
    });
  });
  // Les paires les plus sûres d'abord ; à un dixième près, la durée la plus proche.
  pairs.sort((a, b) => Math.round(b.score * 10) - Math.round(a.score * 10) || a.gap - b.gap || b.score - a.score);
  const places: (string | null)[] = list.map(() => null);
  const used = new Set<number>();
  for (const pair of pairs) {
    if (places[pair.track] !== null || used.has(pair.file)) continue;
    places[pair.track] = files[pair.file]!.id;
    used.add(pair.file);
  }
  return {
    places,
    missing: places.flatMap((place, index) => (place === null ? [index] : [])),
    unknown: files.filter((_, index) => !used.has(index)).map((file) => file.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// La lecture des plateformes : leurs réponses JSON, une page à la fois
// ---------------------------------------------------------------------------------------------------------------

/** Une page de la liste d'une playlist : son titre (la première page), ses morceaux, l'adresse de la page suivante. */
export type PlatformPage = { title: string; tracks: ListedTrack[]; next: string | null };

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const seconds = (value: unknown, unit = 1) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value / unit) : null);

/**
 * Deezer, sans clé : GET https://api.deezer.com/playlist/<id> (la playlist et ses premiers morceaux), puis les pages de
 * GET …/playlist/<id>/tracks (`next`). Une erreur arrive avec le statut 200, dans `error`.
 */
export function listeDeezer(body: unknown): PlatformPage {
  const root = record(body);
  const error = record(root.error);
  if (Object.keys(error).length) throw new Error(text(error.message) || "Deezer ne trouve pas cette playlist.");
  const page = Object.hasOwn(root, "tracks") ? record(root.tracks) : root;
  return {
    title: text(root.title),
    tracks: list(page.data).flatMap((item) => {
      const track = record(item);
      const title = text(track.title);
      return title ? [{ artist: text(record(track.artist).name), title, duration: seconds(track.duration) }] : [];
    }),
    next: text(page.next) || null,
  };
}

/** « PT1H2M5S » : la durée d'une vidéo YouTube, en secondes. */
export function isoDuration(value: string): number | null {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (!match || value.trim() === "P" || value.trim() === "PT") return null;
  const [, d, h, m, s] = match;
  const total = Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : null;
}

/** Ce que YouTube ajoute aux titres : « (Official Video) », « [Official Audio] », « | Lyrics »… */
const YOUTUBE_NOISE = /\s*[([](?:[^)\]]*\b(?:official|officiel|video|vidéo|clip|audio|lyrics?|paroles|visuali[sz]er|hd|hq|4k)\b[^)\]]*)[)\]]|\s+\|.*$/gi;

/**
 * YouTube, avec la clé de l'API Data : GET …/youtube/v3/playlistItems?part=snippet&playlistId=<id>, une page de 50 au
 * plus (`nextPageToken`), et les durées de ses vidéos (GET …/videos?part=contentDetails&id=…), par identifiant. Le
 * titre d'une vidéo, « Artiste - Titre (Official Video) », donne l'artiste et le titre ; sans tiret, l'artiste est la
 * chaîne (« Artiste - Topic » pour YouTube Music). Les vidéos supprimées ou privées sont sautées.
 */
export function listeYouTube(body: unknown, durations: Map<string, number> = new Map()): PlatformPage & { nextToken: string | null } {
  const root = record(body);
  const error = record(root.error);
  if (Object.keys(error).length) throw new Error(text(error.message) || "YouTube ne trouve pas cette playlist.");
  const tracks = list(root.items).flatMap((item) => {
    const snippet = record(record(item).snippet);
    const raw = text(snippet.title);
    if (!raw || /^(?:deleted|private) video$/i.test(raw)) return [];
    const videoId = text(record(snippet.resourceId).videoId) || text(record(record(item).contentDetails).videoId);
    const clean = raw.replace(YOUTUBE_NOISE, "").trim();
    const parts = clean.split(/\s+[-–—]\s+/);
    const channel = text(snippet.videoOwnerChannelTitle).replace(/\s*-\s*Topic$/i, "");
    const [artist, title] = parts.length > 1 ? [parts[0]!, parts.slice(1).join(" - ")] : [channel, clean];
    return [{ artist, title, duration: durations.get(videoId) ?? null }];
  });
  return { title: "", tracks, next: null, nextToken: text(root.nextPageToken) || null };
}

/** Les identifiants des vidéos d'une page de YouTube, pour en demander les durées. */
export function youTubeIds(body: unknown): string[] {
  return list(record(body).items)
    .map((item) => text(record(record(record(item).snippet).resourceId).videoId) || text(record(record(item).contentDetails).videoId))
    .filter(Boolean);
}

/** Les durées d'une réponse de GET …/youtube/v3/videos?part=contentDetails. */
export function youTubeDurations(body: unknown): Map<string, number> {
  const durations = new Map<string, number>();
  for (const item of list(record(body).items)) {
    const video = record(item);
    const duration = isoDuration(text(record(video.contentDetails).duration));
    if (text(video.id) && duration) durations.set(text(video.id), duration);
  }
  return durations;
}

/**
 * SoundCloud, avec le compte relié de la publication (9.14) : GET https://api.soundcloud.com/resolve?url=<adresse>
 * mène à la playlist (GET /playlists/<urn>, ses morceaux compris). Si elle n'en rend qu'une partie (moins que
 * `track_count`), `next` donne l'adresse de ses morceaux (`tracks_uri`), à lire par pages
 * (?linked_partitioning=true : `collection`, puis `next_href`), et ses morceaux à elle sont laissés de côté. L'artiste
 * vient du champ « artiste » du morceau, sinon de son titre (« Artiste - Titre »), sinon du compte qui l'a posté.
 */
export function listeSoundCloud(body: unknown): PlatformPage {
  const root = record(body);
  const paged = Object.hasOwn(root, "collection");
  if (!paged && text(root.kind) !== "playlist") throw new Error("Ce lien SoundCloud ne mène pas à une playlist.");
  const items = list(paged ? root.collection : root.tracks);
  const count = typeof root.track_count === "number" ? root.track_count : null;
  const partial = !paged && count !== null && items.length < count && text(root.tracks_uri) !== "";
  return {
    title: text(root.title),
    tracks: partial
      ? []
      : items.flatMap((item) => {
          const track = record(item);
          const raw = text(track.title);
          if (!raw) return [];
          const named = text(track.metadata_artist) || text(record(track.publisher_metadata).artist);
          const parts = raw.split(/\s+[-–—]\s+/);
          const [artist, title] = named ? [named, raw] : parts.length > 1 ? [parts[0]!, parts.slice(1).join(" - ")] : [text(record(track.user).username), raw];
          return [{ artist, title, duration: seconds(track.duration, 1000) }];
        }),
    next: paged ? text(root.next_href) || null : partial ? text(root.tracks_uri) : null,
  };
}
