/**
 * Radio Cult, où tourne Parabole en attendant BUTTON. Son API publique répond sans clé. La programmation et
 * l'historique ne s'ouvrent qu'à son propre site dans un navigateur (CORS) : c'est notre serveur qui les lit, comme le
 * faisait le relais de l'ancien vercel.json. Ces deux adresses ne sont pas documentées par Radio Cult (ce sont celles de
 * ses widgets) : si elles changent, notre API répond 502 et les panneaux disent « indisponible ».
 *
 * Chaque réponse est traduite dans le format Radiocompas (types.ts), le seul que la page connaisse.
 */
import type { History, NowPlaying, Schedule, ScheduleItem, Track } from "./types";

const STATION = "parabole-radio-b02d5385";
const API = `https://api.radiocult.fm/api/station/${STATION}`;

/** Le flux de la station (Icecast, MP3 160 kb/s), que le lecteur lit directement. */
export const stream = `https://${STATION}.radiocult.fm/stream`;
/** Le fuseau de la station : les panneaux donnent les heures de Paris. */
export const timezone = "Europe/Paris";

async function get(path: string): Promise<any> {
  const answer = await fetch(API + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!answer.ok) throw new Error(`Radio Cult ${path} : HTTP ${answer.status}`);
  return answer.json();
}

// Les tags de Radio Cult finissent parfois par une espace.
const tagText = (s: unknown) => String(s ?? "").trim();
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/**
 * Ce qui passe. Radio Cult répond {status: schedule | defaultPlaylist | offAir, content : l'émission à l'antenne,
 * metadata : le morceau, musicRecognition : le morceau reconnu pendant un direct}.
 */
export async function nowPlaying(): Promise<NowPlaying> {
  const { result } = await get("/schedule/live");
  const { status, content, metadata, musicRecognition } = result ?? {};
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

/** La programmation, de la veille (pour les heures déjà passées d'aujourd'hui) à dans 7 jours. */
export async function schedule(): Promise<Schedule> {
  const from = new Date(Date.now() - 86400000).toISOString();
  const to = new Date(Date.now() + 7 * 86400000).toISOString();
  // {schedules: [{start, end, title, media: {type: live | mix | playlist}}]}
  const { schedules } = await get(`/schedule?startDate=${from}&endDate=${to}`);
  const kinds: Record<string, ScheduleItem["kind"]> = { live: "direct", mix: "set" };
  return {
    timezone,
    items: list(schedules).map((s) => ({
      starts_at: s.start,
      ends_at: s.end,
      title: tagText(s.title),
      kind: kinds[s.media?.type] ?? "emission",
    })),
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
