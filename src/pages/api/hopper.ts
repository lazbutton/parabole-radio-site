/**
 * GET /api/hopper?artist=…&title=… : la page hppr.fr d'un morceau et les plateformes où Hopper le trouve, pour l'ouvrir
 * sur la plateforme de chaque auditeur (le lien « Retrouver » d'HISTORIQUE, les logos de l'accueil). Même contrat
 * qu'OutLive (README de Hopper, « OutLive (Radio Campus) ») :
 *   POST https://hppr.fr/api/resolve { track: { artist, title } }
 *   → 200 { id, url } quand une plateforme a le morceau mot pour mot, 422 quand aucune ne l'a.
 * Les plateformes : le champ `platforms` de cette réponse quand Hopper le donne ; sinon, les pages du morceau sur
 * chaque plateforme que la page hppr.fr déclare (sameAs, dans ses données schema.org), lue comme un robot : Hopper ne
 * compte alors ni visite ni recherche YouTube. Chaque logo mène à https://hppr.fr/<id>/go/<plateforme>.
 * Répond { url, platforms } ou { url: null, platforms: [] }. Les réponses sont gardées 30 jours par le cache de
 * Vercel : chaque morceau n'est demandé qu'une fois, quel que soit l'auditeur (puis redemandé après 30 jours, comme le
 * fait OutLive) ; une heure seulement quand la page n'a pas pu être lue. « Occupé » ou une erreur ne sont pas gardés :
 * le morceau sera redemandé plus tard.
 * HOPPER_KEY (réglage Vercel, facultatif) est une clé partenaire de HOPPER_PARTNER_KEYS côté Hopper : avec elle,
 * Parabole a sa propre limite (60 par minute) au lieu de celle des adresses partagées de Vercel (10).
 */
import type { APIRoute } from "astro";
import { HOPPER_KEY } from "astro:env/server";
import { json } from "../../lib/cache";

export const prerender = false;

const HOPPER = "https://hppr.fr/api/resolve";
const KEEP = "public, max-age=3600, s-maxage=2592000";
const RETRY = "public, max-age=600, s-maxage=3600";
const ROBOT = "ParaboleRadioBot/1.0 (+https://parabole-radio-site.vercel.app)";

/** Les plateformes de Hopper, dans l'ordre de sa page lien : écouter, puis acheter. */
const PLATFORMS = ["spotify", "deezer", "apple", "ytmusic", "tidal", "soundcloud", "bandcamp", "itunes", "beatport", "discogs"];

/** La plateforme d'une page de morceau, d'après son adresse ; null pour une autre. */
function platformOf(link: unknown): string | null {
  let page: URL;
  try {
    page = new URL(String(link));
  } catch {
    return null;
  }
  const host = page.hostname.replace(/^www\./, ""),
    on = (domain: string) => host === domain || host.endsWith("." + domain);
  if (host === "open.spotify.com") return "spotify";
  if (on("deezer.com")) return "deezer";
  if (host === "itunes.apple.com") return "itunes";
  if (host === "music.apple.com") return page.searchParams.get("app") === "itunes" ? "itunes" : "apple";
  if (host === "music.youtube.com") return "ytmusic";
  if (on("tidal.com")) return "tidal";
  if (on("soundcloud.com")) return "soundcloud";
  if (on("bandcamp.com")) return "bandcamp";
  if (on("beatport.com")) return "beatport";
  if (on("discogs.com")) return "discogs";
  return null;
}

/** Les plateformes que la page hppr.fr du morceau déclare (sameAs de son MusicRecording) ; null si elle n'a pas pu être lue. */
async function readPlatforms(page: string): Promise<string[] | null> {
  try {
    const answer = await fetch(page, { headers: { "User-Agent": ROBOT, Accept: "text/html" }, signal: AbortSignal.timeout(8000) });
    if (!answer.ok) return null;
    const html = await answer.text(),
      found = new Set<string>();
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const item = node as Record<string, unknown>;
      if (item["@type"] === "MusicRecording" && Array.isArray(item.sameAs))
        item.sameAs.forEach((link) => {
          const platform = platformOf(link);
          if (platform) found.add(platform);
        });
      Object.values(item).forEach(visit);
    };
    for (const [, block] of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try {
        visit(JSON.parse(block));
      } catch {}
    }
    return PLATFORMS.filter((platform) => found.has(platform));
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ url }) => {
  const artist = String(url.searchParams.get("artist") || "").trim().slice(0, 300);
  const title = String(url.searchParams.get("title") || "").trim().slice(0, 300);
  if (!artist || !title) return json({ error: "invalid" }, "no-store", 400);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (HOPPER_KEY) headers["X-Hopper-Key"] = HOPPER_KEY;
  try {
    const answer = await fetch(HOPPER, {
      method: "POST",
      headers,
      body: JSON.stringify({ track: { artist, title } }),
      signal: AbortSignal.timeout(25000),
    });
    if (answer.status === 200) {
      const found: { url?: unknown; platforms?: unknown } = await answer.json();
      const link = typeof found.url === "string" && found.url.startsWith("https://hppr.fr/") ? found.url : null;
      if (!link) return json({ url: null, platforms: [] }, KEEP);
      const platforms = Array.isArray(found.platforms)
        ? PLATFORMS.filter((platform) => (found.platforms as unknown[]).includes(platform))
        : await readPlatforms(link);
      return json({ url: link, platforms: platforms || [] }, platforms ? KEEP : RETRY);
    }
    if (answer.status === 422) return json({ url: null, platforms: [] }, KEEP);
    return json({ error: answer.status === 429 ? "busy" : "unavailable" }, "no-store", 503);
  } catch {
    return json({ error: "unavailable" }, "no-store", 503);
  }
};
