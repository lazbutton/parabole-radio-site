/**
 * Ce que répond la loupe de l'en-tête (src/pages/api/recherche.ts) et ce que montre sa page de télétexte
 * (src/scripts/recherche.ts) : les artistes, les émissions et les événements que trouve la recherche du CMS.
 */

/** Les artistes rendus au plus ; la loupe en montre cinq et propose de voir les autres dans la grille des résidents. */
export const ARTISTES_MAX = 20;

export type ResultatsRecherche = {
  query: string;
  /** Le nom, l'adresse de la page et les activités (DJ, Podcast…) de chaque artiste trouvé. */
  artists: { slug: string; name: string; tags: string[] }[];
  /** D'autres artistes répondent, au-delà des ARTISTES_MAX de la liste. */
  moreArtists: boolean;
  /** Les cinq premières émissions : le titre, le type (DJ set, Playlist, Podcast) et la diffusion (ISO 8601). */
  shows: { title: string; type: string; broadcastAt: string }[];
  /** Les cinq premiers événements : l'adresse de la page, le titre, le début (ISO 8601) et le lieu. */
  events: { slug: string; title: string; startsAt: string; venue: string | null }[];
};
