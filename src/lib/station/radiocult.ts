/**
 * Radio Cult, où tourne Parabole en attendant BUTTON. Son API (https://www.radiocult.fm/docs/api, lue par
 * ../radiocult.ts) se lit avec une clé publishable (PUBLIC_RADIOCULT_KEY, astro.config.mjs), qui n'ouvre que la
 * lecture. Sans clé, seuls le direct, la programmation et l'historique répondent : le site marche comme avant, sans le
 * temps réel, ni les artistes des créneaux, ni les passages des résidents. La programmation et l'historique ne
 * s'ouvrent qu'à son propre site dans un navigateur (CORS) : c'est notre serveur qui les lit. Le direct en temps réel,
 * lui, arrive dans la page (subscribe).
 *
 * Chaque réponse est traduite dans le format Radiocompas (types.ts), le seul que la page connaisse.
 */
import { KEY, ORIGIN, radiocult as get, STATION } from "../radiocult";
import type { History, NowPlaying, Schedule, ScheduleItem, Track } from "./types";

/** Le flux de la station (Icecast, MP3 160 kb/s), que le lecteur lit directement. */
export const stream = `https://${STATION}.radiocult.fm/stream`;
/** Le fuseau de la station : les panneaux donnent les heures de Paris. */
export const timezone = "Europe/Paris";

// Les tags de Radio Cult finissent parfois par une espace.
const tagText = (s: unknown) => String(s ?? "").trim();
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/**
 * Ce qui passe, traduit. Radio Cult donne {status: schedule | defaultPlaylist | offAir, content : l'émission à
 * l'antenne, metadata : le morceau, musicRecognition : le morceau reconnu pendant un direct}, par l'API comme par le
 * temps réel.
 */
function toNowPlaying({ status, content, metadata, musicRecognition }: any = {}): NowPlaying {
  const m = musicRecognition?.metadata || metadata || {};
  const track = status !== "offAir" && tagText(m.title) !== "" && tagText(m.title) !== "Off Air";
  const show = status === "schedule" && content ? content : null;
  return {
    title: track ? tagText(m.title) : "",
    artist: track ? tagText(m.artist) : "",
    album: track ? tagText(m.album) : "",
    show: show ? tagText(show.title) : "",
    source: status === "offAir" ? "off" : !show ? "autodj" : show.media?.type === "live" ? "live" : "show",
    duration: track ? Number(m.duration) || 0 : 0,
    // la progression du morceau se compte depuis son début
    elapsed: 0,
    received_at: track ? m.playoutStartIsoTimestamp || null : null,
  };
}

export async function nowPlaying(): Promise<NowPlaying> {
  const { result } = await get("/schedule/live");
  return toNowPlaying(result);
}

/** Les artistes de la station, par identifiant (clé nécessaire), gardés dix minutes. Vide sans clé ou en cas d'échec. */
let artistsCache: { at: number; byId: Map<string, any> } | null = null;
async function artists(): Promise<Map<string, any>> {
  if (!KEY) return new Map();
  if (artistsCache && Date.now() - artistsCache.at < 10 * 60000) return artistsCache.byId;
  try {
    const { artists } = await get("/artists");
    artistsCache = { at: Date.now(), byId: new Map(list(artists).map((a) => [a.id, a])) };
  } catch (e) {
    // les créneaux s'affichent sans leurs artistes ; on réessaie à la prochaine programmation
    return artistsCache?.byId ?? new Map();
  }
  return artistsCache.byId;
}

/** La programmation, de la veille (pour les heures déjà passées d'aujourd'hui) à dans 7 jours. */
export async function schedule(): Promise<Schedule> {
  const from = new Date(Date.now() - 86400000).toISOString();
  const to = new Date(Date.now() + 7 * 86400000).toISOString();
  // {schedules: [{start, end, title, media: {type: live | mix | playlist}, artistIds}]}
  const [{ schedules }, byId] = await Promise.all([get(`/schedule?startDate=${from}&endDate=${to}`), artists()]);
  const kinds: Record<string, ScheduleItem["kind"]> = { live: "direct", mix: "set" };
  return {
    timezone,
    items: list(schedules).map((s) => {
      const names = list(s.artistIds)
        .map((id) => tagText(byId.get(id)?.name))
        .filter(Boolean);
      return {
        starts_at: s.start,
        ends_at: s.end,
        title: tagText(s.title),
        kind: kinds[s.media?.type] ?? "emission",
        ...(names.length ? { artists: names } : {}),
      };
    }),
  };
}

/** Les 20 derniers morceaux. Radio Cult n'y inscrit un morceau qu'environ 2 minutes après sa fin : la page comble ce retard avec ceux qu'elle a vus passer. */
export async function history(): Promise<History> {
  // {data: [{playoutStart, title, artist, album}]}, du plus récent au plus ancien ; 5 sans `limit`
  const { data } = await get("/streaming/history/latest-results?limit=20");
  return {
    items: list(data).map(
      (t): Track => ({ played_at: t.playoutStart, title: tagText(t.title), artist: tagText(t.artist), album: tagText(t.album) }),
    ),
  };
}

/** Un nom comparable : « Éloïse B. » et « eloise-b » se valent. */
const sameName = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Les débuts (ISO 8601) des prochains passages d'un artiste sur la grille de Radio Cult, sur 60 jours. L'artiste y est
 * retrouvé par son identifiant Radio Cult s'il est relié, sinon par son nom ou son adresse. Vide sans clé, s'il n'y est
 * pas, ou en cas d'échec : la page s'en passe.
 */
export async function upcomingSlots(artist: { name: string; slug: string; radiocultId?: string | null }): Promise<string[]> {
  try {
    const all = [...(await artists()).values()];
    const ours = new Set([sameName(artist.name), sameName(artist.slug)].filter(Boolean));
    const found =
      all.find((a) => artist.radiocultId && a.id === artist.radiocultId) ??
      all.find((a) => [sameName(a.name), sameName(a.slug)].some((n) => ours.has(n)));
    if (!found) return [];
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 60 * 86400000).toISOString();
    const { schedules } = await get(`/artists/${encodeURIComponent(found.id)}/schedule?startDate=${from}&endDate=${to}`);
    return list(schedules)
      .map((s) => s.startDateUtc || s.start)
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Le direct en temps réel, dans la page : Radio Cult pousse chaque changement (Socket.IO, événement
 * « player-metadata »), comme pour ses propres lecteurs. `onNow` reçoit ce qui passe, au format Radiocompas ;
 * `onLink` dit si le lien tient, pour que la page reprenne ses relances quand il tombe. Rien sans clé : renvoie null.
 * Renvoie de quoi fermer le lien.
 */
export function subscribe(onNow: (now: NowPlaying) => void, onLink: (up: boolean) => void): (() => void) | null {
  if (!KEY) return null;
  let socket: { close(): void } | null = null,
    closed = false;
  import("socket.io-client")
    .then(({ io }) => {
      if (closed) return;
      const s = io(ORIGIN, { auth: { "x-api-key": KEY }, transports: ["websocket"], query: { stationId: STATION } });
      s.on("connect", () => onLink(true));
      s.on("disconnect", () => onLink(false));
      s.on("connect_error", () => onLink(false));
      s.on("player-metadata", (result: unknown) => onNow(toNowPlaying(result)));
      socket = s;
    })
    .catch(() => onLink(false));
  return () => {
    closed = true;
    socket?.close();
  };
}
