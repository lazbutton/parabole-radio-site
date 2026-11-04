/**
 * Les filtres du site, prêts pour leurs menus : pour une page (les shows d'un type, les résidents, les événements),
 * ses filtres dans l'ordre de l'admin, leurs groupes, et les étiquettes de chaque groupe dans l'ordre alphabétique,
 * chacun avec son nombre de contenus publiés. Un groupe compte les contenus de toutes ses étiquettes, chacun une fois.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { artist, artistTag, event, eventTag, facet, facetScope, show, showTag, showType, tag, tagGroup, tagMember, type FacetScope, type ShowType } from "../schema.ts";
import { frenchOrder, oneOf } from "./common.ts";

export type FacetTag = { slug: string; name: string; count: number };
export type FacetGroup = FacetTag & { tags: FacetTag[] };
/** Un filtre et ses groupes. `showTypes` : les types de show qu'il range (vide : tous), pour une page qui les montre tous. */
export type FacetMenu = { slug: string; name: string; showTypes: ShowType[]; groups: FacetGroup[] };

export type FacetFilters = {
  /** Ce que la page montre. */
  scope: FacetScope;
  /** Pour les shows : le type de la page. Sans type, les filtres de tous les types. */
  type?: ShowType;
  /** Garder aussi les étiquettes qui ne servent à aucun contenu publié (par défaut, elles sont retirées). */
  all?: boolean;
};

/** Les contenus publiés de la page et leurs étiquettes : une ligne par lien. */
function links(tx: Tx, { scope, type }: FacetFilters) {
  if (scope === "artist")
    return tx
      .select({ item: artistTag.artistId, tagId: artistTag.tagId })
      .from(artistTag)
      .innerJoin(artist, and(eq(artist.id, artistTag.artistId), eq(artist.status, "published")));
  if (scope === "event")
    return tx
      .select({ item: eventTag.eventId, tagId: eventTag.tagId })
      .from(eventTag)
      .innerJoin(event, and(eq(event.id, eventTag.eventId), eq(event.status, "published")));
  return tx
    .select({ item: showTag.showId, tagId: showTag.tagId })
    .from(showTag)
    .innerJoin(show, and(eq(show.id, showTag.showId), eq(show.status, "published"), type ? eq(show.type, type) : undefined));
}

export async function listFacets(tx: Tx, filters: FacetFilters): Promise<FacetMenu[]> {
  const { scope, type, all = false } = filters;
  if (!oneOf(facetScope.enumValues, scope) || (type !== undefined && (scope !== "show" || !oneOf(showType.enumValues, type)))) return [];
  const facets = await tx
    .select({ id: facet.id, slug: facet.slug, name: facet.name, showTypes: facet.showTypes })
    .from(facet)
    .where(and(eq(facet.scope, scope), type ? sql`(cardinality(${facet.showTypes}) = 0 or ${type}::public.show_type = any(${facet.showTypes}))` : undefined))
    .orderBy(asc(facet.position), asc(facet.name));
  if (!facets.length) return [];
  const groups = await tx
    .select({ facetId: tagGroup.facetId, tagId: tagGroup.tagId, slug: tag.slug, name: tag.name })
    .from(tagGroup)
    .innerJoin(tag, eq(tag.id, tagGroup.tagId))
    .orderBy(asc(tagGroup.position), asc(tag.name));
  const members = await tx
    .select({ facetId: tagMember.facetId, groupId: tagMember.groupId, tagId: tagMember.tagId, slug: tag.slug, name: tag.name })
    .from(tagMember)
    .innerJoin(tag, eq(tag.id, tagMember.tagId));

  // Les contenus de chaque étiquette, pour compter ceux d'un groupe sans compter deux fois un show Club et Amapiano.
  const itemsOf = new Map<string, Set<string>>();
  for (const link of await links(tx, filters)) {
    const items = itemsOf.get(link.tagId) ?? new Set<string>();
    items.add(link.item);
    itemsOf.set(link.tagId, items);
  }
  const count = (...tagIds: string[]) => new Set(tagIds.flatMap((id) => [...(itemsOf.get(id) ?? [])])).size;

  return facets
    .map((one) => ({
      slug: one.slug,
      name: one.name,
      showTypes: one.showTypes,
      groups: groups
        .filter((group) => group.facetId === one.id)
        .map((group) => {
          const own = members.filter((member) => member.facetId === one.id && member.groupId === group.tagId);
          const tags = own
            .map((member) => ({ slug: member.slug, name: member.name, count: count(member.tagId) }))
            .filter((member) => all || member.count > 0)
            .sort((a, b) => frenchOrder.compare(a.name, b.name));
          return { slug: group.slug, name: group.name, count: count(group.tagId, ...own.map((member) => member.tagId)), tags };
        })
        .filter((group) => all || group.count > 0),
    }))
    .filter((one) => all || one.groups.length > 0);
}
