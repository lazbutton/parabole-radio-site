/**
 * GET /api/direct : ce qui passe à l'antenne, au format Radiocompas (src/lib/station/types.ts). La page le demande
 * toutes les 10 s ; 5 s de cache suffisent pour qu'un seul appel parte vers la station, quel que soit le nombre
 * d'auditeurs. La progression du morceau ne vieillit pas avec le cache : elle se compte depuis son heure de début.
 */
import type { APIRoute } from "astro";
import { cached, json } from "../../lib/cache";
import { nowPlaying } from "../../lib/station";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    return json(await cached("direct", 5000, nowPlaying), "public, max-age=0, s-maxage=5, stale-while-revalidate=10");
  } catch {
    return json({ error: "unavailable" }, "no-store", 502);
  }
};
