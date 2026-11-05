/**
 * Les étiquettes d'une fiche de show, rangées pour être choisies à la souris : dans l'admin (ShowEditor) et sur la page
 * d'envoi d'un résident (src/components/envoi), qui n'en garde que les filtres.
 */
import { useMemo } from "react";
import type { Choice, FacetChoice, TagChoice } from "./types";

/**
 * Les étiquettes de la fiche, rangées pour être choisies à la souris : les filtres qui valent pour ce type de show, ce
 * qui a été choisi ailleurs (dans un filtre d'un autre type de show), et ce qui n'est dans aucun filtre (« Autres »).
 */
export function useTagChoices(sheet: { facets: FacetChoice[]; tags: TagChoice[] }, chosen: string[], type: string) {
  return useMemo(() => {
    const facets = new Map(sheet.facets.map((facet) => [facet.id, facet]));
    const names = new Map(sheet.tags.map((tag) => [tag.id, tag.name]));
    const places = new Map(sheet.tags.map((tag) => [tag.id, tag.places]));
    const fits = (facetId: string) => {
      const facet = facets.get(facetId);
      return !type || !facet || !facet.showTypes.length || facet.showTypes.includes(type as never);
    };
    /** Les autres places d'une étiquette, en mots : l'aide au survol d'une pastille. */
    const elsewhere = (tagId: string, facetId: string, groupId: string | null) =>
      (places.get(tagId) ?? [])
        .filter((place) => !(place.facetId === facetId && place.groupId === groupId))
        .map((place) => (place.groupId ? `${facets.get(place.facetId)?.name} › ${names.get(place.groupId)}` : `${facets.get(place.facetId)?.name}`));
    const isNew = (value: string) => value.startsWith("nouveau:");
    // Rangées seulement dans des filtres d'un autre type de show : elles ne comptent pas pour celui-ci.
    const stray = chosen.filter((value) => !isNew(value) && (places.get(value)?.length ?? 0) > 0 && !places.get(value)!.some((place) => fits(place.facetId)));
    // Nouvelles, ou dans aucun filtre : les « Autres ».
    const loose = chosen.filter((value) => isNew(value) || !(places.get(value)?.length ?? 0));
    const looseOptions: Choice[] = sheet.tags.filter((tag) => !tag.places.length).map((tag) => ({ id: tag.id, name: tag.name }));
    return { names, elsewhere, shown: sheet.facets.filter((facet) => fits(facet.id)), stray, loose, looseOptions };
  }, [sheet.facets, sheet.tags, chosen, type]);
}
