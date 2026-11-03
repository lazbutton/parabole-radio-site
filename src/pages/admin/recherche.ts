/**
 * GET /admin/recherche?q=… : la recherche de partout (⌘K, src/components/admin/CommandPalette.tsx). Quelques shows,
 * quelques artistes et quelques événements, brouillons compris, cherchés comme dans leurs listes. Derrière la garde de
 * l'admin, comme tout /admin : une session expirée renvoie vers la connexion, et l'écran le dit.
 */
import type { APIRoute } from "astro";
import type { SearchResults } from "../../components/admin/types";
import { parisDay } from "../../lib/admin/format";
import { json } from "../../lib/admin/views";

export const prerender = false;

/** Combien de résultats par sorte : de quoi choisir sans faire défiler. */
const EACH = 6;

export const GET: APIRoute = async ({ locals, url }) => {
  const q = url.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  if (!q) return json({ shows: [], artists: [], events: [] } satisfies SearchResults);
  const admin = locals.admin!;
  const [shows, artists, events] = await Promise.all([admin.listShows({ q, limit: EACH }), admin.listArtists({ q }), admin.listEvents({ q, limit: EACH })]);
  return json({
    shows: shows.items.map((item) => ({
      id: item.id,
      title: item.title,
      artists: item.artists.join(", "),
      date: item.broadcastAt ? parisDay(item.broadcastAt) : "",
      type: item.type,
      status: item.status,
    })),
    artists: artists.groups
      .flatMap((group) => group.artists)
      .slice(0, EACH)
      .map((artist) => ({ id: artist.id, name: artist.name, role: artist.role, status: artist.status, shows: artist.shows })),
    events: events.items.map((item) => ({ id: item.id, title: item.title, date: parisDay(item.startsAt), venue: item.venue ?? "", status: item.status })),
  } satisfies SearchResults);
};
