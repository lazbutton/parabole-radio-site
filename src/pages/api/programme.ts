/**
 * GET /api/programme : la programmation de la veille à dans 7 jours, au format Radiocompas
 * ({timezone, items: [{starts_at, ends_at, title, kind}]}). Gardée une minute.
 */
import type { APIRoute } from "astro";
import { cached, json } from "../../lib/cache";
import { schedule } from "../../lib/station";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    return json(await cached("programme", 60000, schedule), "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  } catch {
    return json({ error: "unavailable" }, "no-store", 502);
  }
};
