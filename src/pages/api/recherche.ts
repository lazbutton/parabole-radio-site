/**
 * GET /api/recherche?q=… : la loupe de l'en-tête (src/scripts/recherche.ts). La recherche plein texte du CMS
 * (cms/src/read/search.ts) : en français, sans accents, par débuts de mots, sur les artistes, les émissions et les
 * événements publiés ; moins de deux lettres ne trouvent rien. Le cache de Vercel garde chaque recherche une minute,
 * puis la ressert le temps de la refaire, comme /api/fond. Base injoignable : 502, et la loupe le dit.
 */
import { LABELS } from "@parabole/cms";
import type { APIRoute } from "astro";
import { json } from "../../lib/cache";
import { reader } from "../../lib/cms";
import { ARTISTES_MAX, type ResultatsRecherche } from "../../lib/recherche";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const query = (url.searchParams.get("q") ?? "").slice(0, 80);
  try {
    // un artiste de plus que la liste : de quoi savoir s'il y en a d'autres
    const found = await (await reader()).search(query, { limit: ARTISTES_MAX + 1 });
    const body: ResultatsRecherche = {
      query: found.query,
      artists: found.artists.slice(0, ARTISTES_MAX).map(({ slug, name, tags }) => ({ slug, name, tags: tags.map((tag) => tag.name) })),
      moreArtists: found.artists.length > ARTISTES_MAX,
      shows: found.shows
        .slice(0, 5)
        .map(({ slug, title, type, broadcastAt }) => ({ slug, title, type: LABELS.showType[type], broadcastAt: new Date(broadcastAt).toISOString() })),
      events: found.events.slice(0, 5).map(({ slug, title, startsAt, venue }) => ({ slug, title, startsAt: new Date(startsAt).toISOString(), venue })),
    };
    const response = json(body, "public, max-age=0, must-revalidate");
    response.headers.set("Vercel-CDN-Cache-Control", "max-age=60, stale-while-revalidate=600");
    return response;
  } catch (failure) {
    console.error("api/recherche : la recherche est impossible", failure);
    return json({ error: "unavailable" }, "no-store", 502);
  }
};
