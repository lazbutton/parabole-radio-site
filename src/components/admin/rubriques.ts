/**
 * Les filtres rangés par rubrique, comme sur le site et comme le schéma des retours du 4 novembre 2026 : Émissions (le
 * podcast et son thème ; la playlist et le DJ set, leur genre, leur géographie et le mood), Résidents, Événements, et
 * les étiquettes « À classer ». La barre latérale (AdminShell) y mène, l'écran des étiquettes (TagsScreen) s'y range.
 */
import { UNPLACED, type FacetScope, type FacetView, type TagsData } from "./types";

export type Rubrique = "emissions" | "residents" | "evenements" | typeof UNPLACED;

/** L'onglet du mood, à côté des filtres des playlists et des DJ sets : une échelle sur la fiche, pas des étiquettes. */
export const MOOD_TAB = "mood";

export const SCOPE_OF_RUBRIQUE = { emissions: "show", residents: "artist", evenements: "event" } as const satisfies Record<string, FacetScope>;
const RUBRIQUE_OF_SCOPE: Record<FacetScope, Rubrique> = { show: "emissions", artist: "residents", event: "evenements" };

/** Les rubriques, dans l'ordre de la barre latérale : leur nom court, et le titre de l'écran. */
export const RUBRIQUES: { slug: Rubrique; label: string; title: string }[] = [
  { slug: "emissions", label: "Émissions", title: "Filtres des émissions" },
  { slug: "residents", label: "Résidents", title: "Filtres des résidents" },
  { slug: "evenements", label: "Événements", title: "Filtres des événements" },
  { slug: UNPLACED, label: "À classer", title: "Étiquettes à classer" },
];

/** L'adresse d'une rubrique : son premier filtre, que le serveur choisit (src/lib/admin/views.ts, tagsData). */
export const rubriqueHref = (slug: Rubrique) => (slug === UNPLACED ? `/admin/etiquettes?filtre=${UNPLACED}` : `/admin/etiquettes?rubrique=${slug}`);

export const isRubrique = (value: string | null | undefined): value is Exclude<Rubrique, typeof UNPLACED> => Boolean(value && Object.hasOwn(SCOPE_OF_RUBRIQUE, value));

/** La rubrique de l'onglet montré : celle de son filtre, le mood dans Émissions, ou la rubrique elle-même quand elle n'a pas encore de filtre. */
export function rubriqueOf(data: Pick<TagsData, "facets" | "current">): Rubrique {
  if (data.current === UNPLACED) return UNPLACED;
  if (data.current === MOOD_TAB) return "emissions";
  if (isRubrique(data.current)) return data.current;
  const facet = data.facets.find((one) => one.slug === data.current);
  return facet ? RUBRIQUE_OF_SCOPE[facet.scope] : "emissions";
}

/** Les filtres d'une rubrique, dans l'ordre du site. */
export const facetsOf = (facets: FacetView[], rubrique: Rubrique) => (isRubrique(rubrique) ? facets.filter((facet) => facet.scope === SCOPE_OF_RUBRIQUE[rubrique]) : []);

/** Les types d'émission, dans l'ordre des onglets du site (TOUT · PODCAST · PLAYLIST · DJ SET), et leur nom ici. */
const TYPE_WORDS = { podcast: "Podcast", playlist: "Playlist", dj_set: "DJ sets" } as const;

/**
 * Les filtres des émissions rangés par types, comme le schéma : « Podcast » (Thème), puis « Playlist + DJ sets »
 * (Genre, Géographie) avec le mood. Un filtre sans type vaut pour toutes les émissions.
 */
export function showFacetGroups(facets: FacetView[]): { label: string; facets: FacetView[]; mood: boolean }[] {
  const groups: { key: string; label: string; facets: FacetView[]; mood: boolean }[] = [];
  for (const facet of facets) {
    const types = (Object.keys(TYPE_WORDS) as (keyof typeof TYPE_WORDS)[]).filter((type) => facet.showTypes.includes(type));
    const key = types.join("+");
    const label = types.length ? types.map((type) => TYPE_WORDS[type]).join(" + ") : "Toutes les émissions";
    const group = groups.find((one) => one.key === key);
    if (group) group.facets.push(facet);
    else groups.push({ key, label, facets: [facet], mood: false });
  }
  // Le mood vaut pour les playlists et les DJ sets : il suit leurs filtres, ou vient seul s'ils n'en ont pas.
  const moodGroup = groups.find((group) => group.key === "playlist+dj_set");
  if (moodGroup) moodGroup.mood = true;
  else groups.push({ key: "playlist+dj_set", label: "Playlist + DJ sets", facets: [], mood: true });
  return groups;
}
