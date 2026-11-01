/**
 * GET /api/hopper?artist=…&title=… : la page hppr.fr d'un morceau de l'historique, qui l'ouvre sur la plateforme de
 * chaque auditeur. Même contrat qu'OutLive (README de Hopper, « OutLive (Radio Campus) ») :
 *   POST https://hppr.fr/api/resolve { track: { artist, title } }
 *   → 200 { id, url } quand une plateforme a le morceau mot pour mot, 422 quand aucune ne l'a.
 * Répond { url } ou { url: null }. Les deux réponses sont gardées 30 jours par le cache de Vercel : chaque morceau
 * n'est demandé qu'une fois, quel que soit l'auditeur (puis redemandé après 30 jours, comme le fait OutLive).
 * « Occupé » ou une erreur ne sont pas gardés : le morceau sera redemandé plus tard.
 * HOPPER_KEY (réglage Vercel, facultatif) est une clé partenaire de HOPPER_PARTNER_KEYS côté Hopper : avec elle,
 * Parabole a sa propre limite (60 par minute) au lieu de celle des adresses partagées de Vercel (10).
 */
import type { APIRoute } from "astro";
import { HOPPER_KEY } from "astro:env/server";
import { json } from "../../lib/cache";

export const prerender = false;

const HOPPER = "https://hppr.fr/api/resolve";
const KEEP = "public, max-age=3600, s-maxage=2592000";

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
      const { url: link } = await answer.json();
      return json({ url: typeof link === "string" && link.startsWith("https://hppr.fr/") ? link : null }, KEEP);
    }
    if (answer.status === 422) return json({ url: null }, KEEP);
    return json({ error: answer.status === 429 ? "busy" : "unavailable" }, "no-store", 503);
  } catch {
    return json({ error: "unavailable" }, "no-store", 503);
  }
};
