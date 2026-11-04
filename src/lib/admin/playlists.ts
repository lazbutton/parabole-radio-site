/**
 * La liste d'une playlist, lue sur sa plateforme pour l'outil d'assemblage de l'admin (cms/README.md, 9.13), côté
 * serveur. L'outil ne télécharge aucun son : il ne lit que les titres, les artistes et les durées, pour ranger à leur
 * place les fichiers que l'équipe y glisse.
 *
 *   - Deezer : l'API publique, sans clé ;
 *   - YouTube et YouTube Music : l'API Data, avec YOUTUBE_API_KEY ;
 *   - Spotify : plus possible depuis février 2026 (une appli en mode développement ne lit que les playlists de son
 *     propriétaire) ; SoundCloud viendra avec l'appli de la publication (9.14) ; ailleurs (Apple Music, Tidal…) : on
 *     colle la liste.
 *
 * Le serveur n'interroge que les adresses de ces API (et les liens courts de Deezer), jamais l'adresse donnée.
 */
import { listeDeezer, listeYouTube, youTubeDurations, youTubeIds, type ListedTrack } from "@parabole/cms/assemblage";
import { YOUTUBE_API_KEY } from "astro:env/server";

export type PlaylistAnswer = { ok: true; platform: string; title: string; tracks: ListedTrack[] } | { ok: false; error: string };

/** Une playlist de plus de 200 morceaux n'est pas une émission : on s'arrête là. */
const MAX_TRACKS = 200;
const TIMEOUT = 10_000;

type Source = { platform: "deezer"; id: string } | { platform: "deezer-short"; url: string } | { platform: "youtube"; id: string } | { platform: "spotify" } | { platform: "soundcloud" } | { platform: "apple" };

/** La plateforme d'une adresse de playlist, et ce qu'il faut pour la lire ; null pour une adresse inconnue. */
export function sourceOf(input: string): Source | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "");
  if (host === "deezer.com") {
    const id = /\/playlist\/(\d{1,20})/.exec(url.pathname)?.[1];
    return id ? { platform: "deezer", id } : null;
  }
  if (host === "link.deezer.com" || host === "deezer.page.link") return { platform: "deezer-short", url: url.href };
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const id = url.searchParams.get("list");
    return id && /^[\w-]{10,64}$/.test(id) ? { platform: "youtube", id } : null;
  }
  if (host === "open.spotify.com" || host === "spotify.link") return { platform: "spotify" };
  if (host === "soundcloud.com" || host === "on.soundcloud.com") return { platform: "soundcloud" };
  if (host === "music.apple.com") return { platform: "apple" };
  return null;
}

async function getJson(url: string): Promise<unknown> {
  const answer = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
  return answer.json();
}

/** Deezer : la playlist, puis ses pages suivantes s'il y en a (au-delà de 400 morceaux, ou 200 ici). */
async function deezer(id: string): Promise<PlaylistAnswer> {
  const first = listeDeezer(await getJson(`https://api.deezer.com/playlist/${id}`));
  const tracks = [...first.tracks];
  let next = first.next;
  while (next && tracks.length < MAX_TRACKS && next.startsWith("https://api.deezer.com/")) {
    const page = listeDeezer(await getJson(next));
    tracks.push(...page.tracks);
    next = page.next;
  }
  return { ok: true, platform: "Deezer", title: first.title, tracks: tracks.slice(0, MAX_TRACKS) };
}

/** Un lien court de Deezer (link.deezer.com) mène à la playlist : on le suit, sans rien lire d'autre. */
async function deezerShort(url: string): Promise<PlaylistAnswer> {
  const answer = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT) });
  const source = sourceOf(answer.url);
  return source?.platform === "deezer" ? deezer(source.id) : { ok: false, error: "Ce lien court de Deezer ne mène pas à une playlist." };
}

/** YouTube : les pages de 50 vidéos, puis leurs durées, 50 par demande. */
async function youtube(id: string): Promise<PlaylistAnswer> {
  if (!YOUTUBE_API_KEY) return { ok: false, error: "La lecture des playlists YouTube n'est pas branchée (il manque YOUTUBE_API_KEY) : colle la liste." };
  const api = "https://www.googleapis.com/youtube/v3";
  const tracks: ListedTrack[] = [];
  let token: string | null = null;
  do {
    const query = new URLSearchParams({ part: "snippet", maxResults: "50", playlistId: id, key: YOUTUBE_API_KEY });
    if (token) query.set("pageToken", token);
    const body = await getJson(`${api}/playlistItems?${query}`);
    const ids = youTubeIds(body);
    const durations = ids.length ? youTubeDurations(await getJson(`${api}/videos?${new URLSearchParams({ part: "contentDetails", id: ids.join(","), key: YOUTUBE_API_KEY })}`)) : new Map<string, number>();
    const page = listeYouTube(body, durations);
    tracks.push(...page.tracks);
    token = page.nextToken;
  } while (token && tracks.length < MAX_TRACKS);
  return { ok: true, platform: "YouTube", title: "", tracks: tracks.slice(0, MAX_TRACKS) };
}

/** La liste d'une playlist d'après son adresse, ou pourquoi on ne peut pas la lire (et quoi faire à la place). */
export async function readPlaylist(input: string): Promise<PlaylistAnswer> {
  const source = sourceOf(input);
  if (!source) return { ok: false, error: "Ce lien n'est pas celui d'une playlist Deezer ou YouTube : colle la liste à la place." };
  try {
    switch (source.platform) {
      case "deezer":
        return await deezer(source.id);
      case "deezer-short":
        return await deezerShort(source.url);
      case "youtube":
        return await youtube(source.id);
      case "spotify":
        return { ok: false, error: "Spotify ne laisse plus lire les playlists des autres (depuis février 2026) : colle la liste, ou demande-la au curateur." };
      case "soundcloud":
        return { ok: false, error: "Les playlists SoundCloud se liront avec la publication sur SoundCloud, pas encore branchée : colle la liste." };
      case "apple":
        return { ok: false, error: "Apple Music ne se lit pas d'ici : colle la liste." };
    }
  } catch (failure) {
    console.error("Playlist : lecture impossible", source.platform, failure);
    return { ok: false, error: failure instanceof Error && failure.name !== "TimeoutError" && failure.message ? `La plateforme répond : ${failure.message}` : "La plateforme ne répond pas. Réessaie, ou colle la liste." };
  }
}
