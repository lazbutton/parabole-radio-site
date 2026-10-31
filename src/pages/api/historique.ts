/**
 * GET /api/historique[?limit=N] : les derniers morceaux diffusés, du plus récent au plus ancien, au format Radiocompas
 * ({items: [{played_at, title, artist, album}]}) ; 20 au plus. Gardés 15 s : la page ajoute de toute façon les
 * morceaux qu'elle a vus passer et que la station n'a pas encore inscrits.
 */
import type { APIRoute } from "astro";
import { cached, json } from "../../lib/cache";
import { history } from "../../lib/station";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  try {
    const { items } = await cached("historique", 15000, history);
    return json({ items: items.slice(0, limit) }, "public, max-age=0, s-maxage=15, stale-while-revalidate=15");
  } catch {
    return json({ error: "unavailable" }, "no-store", 502);
  }
};
