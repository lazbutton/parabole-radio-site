/**
 * Les étiquettes et les filtres dans l'admin (cms/README.md, « Les étiquettes et les filtres ») : tout le classement
 * d'un coup — les filtres, leurs groupes, les étiquettes de chaque groupe, celles à classer, et ce qui les porte —,
 * l'ajout d'une étiquette ou d'une liste collée à une place, le nom et l'adresse, les places (ranger aussi ailleurs,
 * retirer), l'ordre des groupes et des filtres, la fusion de deux étiquettes, la suppression. Et ce que les fiches
 * proposent : les étiquettes d'un show, d'un artiste. Sous le rôle de la personne connectée (src/admin/index.ts).
 */
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { frenchOrder, outer } from "../read/common.ts";
import { artistTag, eventTag, facet, showTag, tag, tagGroup, tagMember, type FacetScope, type ShowType } from "../schema.ts";
import { slugify } from "../slug.ts";
import type { NotSaved } from "./common.ts";
import { isUuid, type FacetValues } from "./input.ts";

// ---------------------------------------------------------------------------------------------------------------
// Le classement
// ---------------------------------------------------------------------------------------------------------------

export type AdminFacet = {
  id: string;
  slug: string;
  name: string;
  scope: FacetScope;
  showTypes: ShowType[];
  description: string | null;
  /** Ses groupes dans l'ordre ; les étiquettes de chacun dans l'ordre alphabétique (des identifiants d'étiquettes). */
  groups: { tagId: string; members: string[] }[];
};

/** Une étiquette et ce qui la porte, brouillons compris. */
export type AdminTagUse = { id: string; name: string; slug: string; shows: number; artists: number; events: number };

export type Taxonomy = {
  facets: AdminFacet[];
  /** Toutes les étiquettes, dans l'ordre alphabétique ; une étiquette sans place est à classer. */
  tags: AdminTagUse[];
};

const count = (table: typeof showTag | typeof artistTag | typeof eventTag) =>
  sql<number>`(select count(*) from ${table} l where l.tag_id = ${outer(tag.id)})`.mapWith(Number);

/** Tout le classement : les filtres dans leur ordre, leurs groupes, les étiquettes de chaque groupe, et toutes les étiquettes. */
export async function taxonomy(tx: Tx): Promise<Taxonomy> {
  const tags = await tx
    .select({ id: tag.id, name: tag.name, slug: tag.slug, shows: count(showTag), artists: count(artistTag), events: count(eventTag) })
    .from(tag);
  tags.sort((a, b) => frenchOrder.compare(a.name, b.name) || a.slug.localeCompare(b.slug));
  const rank = new Map(tags.map((one, index) => [one.id, index]));
  const facets = await tx
    .select({ id: facet.id, slug: facet.slug, name: facet.name, scope: facet.scope, showTypes: facet.showTypes, description: facet.description })
    .from(facet)
    .orderBy(asc(facet.position), asc(facet.name));
  const groups = await tx.select({ facetId: tagGroup.facetId, tagId: tagGroup.tagId }).from(tagGroup).orderBy(asc(tagGroup.position));
  const members = await tx.select({ facetId: tagMember.facetId, groupId: tagMember.groupId, tagId: tagMember.tagId }).from(tagMember);
  return {
    tags,
    facets: facets.map((one) => ({
      ...one,
      groups: groups
        .filter((group) => group.facetId === one.id)
        .map((group) => ({
          tagId: group.tagId,
          members: members
            .filter((member) => member.facetId === one.id && member.groupId === group.tagId)
            .map((member) => member.tagId)
            .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
        })),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ce que proposent les fiches
// ---------------------------------------------------------------------------------------------------------------

/** Une étiquette à proposer dans une fiche, avec ses places : le filtre, et le groupe (null : c'est un groupe). */
export type AdminTagChoice = { id: string; name: string; places: { facetId: string; groupId: string | null }[] };
/** Un filtre d'une fiche, prêt à montrer : ses groupes dans l'ordre, les étiquettes de chacun dans l'ordre alphabétique. */
export type AdminFacetChoice = { id: string; name: string; description: string | null; showTypes: ShowType[]; groups: { tagId: string; members: string[] }[] };

/**
 * Ce que propose une fiche : les filtres de ce contenu (shows, artistes ou événements) avec leurs groupes et leurs
 * étiquettes, de quoi les choisir à la souris ; et les étiquettes avec leurs places, dans l'ordre de ces filtres, puis
 * celles à classer quand `unplaced` le demande.
 */
export async function tagChoices(tx: Tx, scope: FacetScope, { unplaced = false } = {}): Promise<{ facets: AdminFacetChoice[]; tags: AdminTagChoice[] }> {
  const rows = await tx
    .select({ id: facet.id, name: facet.name, description: facet.description, showTypes: facet.showTypes })
    .from(facet)
    .where(eq(facet.scope, scope))
    .orderBy(asc(facet.position), asc(facet.name));
  const ids = rows.map((one) => one.id);
  const groups = ids.length
    ? await tx.select({ facetId: tagGroup.facetId, tagId: tagGroup.tagId }).from(tagGroup).where(inArray(tagGroup.facetId, ids)).orderBy(asc(tagGroup.position))
    : [];
  const members = ids.length ? await tx.select({ facetId: tagMember.facetId, groupId: tagMember.groupId, tagId: tagMember.tagId }).from(tagMember).where(inArray(tagMember.facetId, ids)) : [];
  const all = await tx.select({ id: tag.id, name: tag.name }).from(tag);
  const names = new Map(all.map((row) => [row.id, row.name]));
  const byName = (a: string, b: string) => frenchOrder.compare(names.get(a) ?? "", names.get(b) ?? "");
  const facets = rows.map((one) => ({
    ...one,
    groups: groups
      .filter((group) => group.facetId === one.id)
      .map((group) => ({
        tagId: group.tagId,
        members: members
          .filter((member) => member.facetId === one.id && member.groupId === group.tagId)
          .map((member) => member.tagId)
          .sort(byName),
      })),
  }));

  const places = new Map<string, AdminTagChoice["places"]>();
  const place = (tagId: string, where: AdminTagChoice["places"][number]) => places.set(tagId, [...(places.get(tagId) ?? []), where]);
  for (const group of groups) place(group.tagId, { facetId: group.facetId, groupId: null });
  for (const member of members) place(member.tagId, { facetId: member.facetId, groupId: member.groupId });
  // L'ordre des fiches : filtre par filtre, chaque groupe puis ses étiquettes.
  const order = facets.flatMap((one) => one.groups.flatMap((group) => [group.tagId, ...group.members]));
  if (unplaced) {
    const placedAnywhere = new Set([
      ...(await tx.select({ id: tagGroup.tagId }).from(tagGroup)).map((row) => row.id),
      ...(await tx.select({ id: tagMember.tagId }).from(tagMember)).map((row) => row.id),
    ]);
    order.push(...all.filter((row) => !placedAnywhere.has(row.id)).sort((a, b) => frenchOrder.compare(a.name, b.name)).map((row) => row.id));
  }
  const tags = [...new Set(order)].map((id) => ({ id, name: names.get(id) ?? "", places: places.get(id) ?? [] }));
  return { facets, tags };
}

/** Une ligne du menu « Étiquette » d'une liste : un groupe, ou une étiquette de ce groupe (en retrait). */
export type TagFilterOption = { id: string; name: string; group: boolean; count: number };
export type TagFilterMenu = { facet: string; options: TagFilterOption[] }[];

/**
 * Le menu « Étiquette » des listes de l'admin (shows, artistes), rangé comme les filtres du site : pour chaque filtre de
 * ce contenu, ses groupes et leurs étiquettes, avec leur nombre de contenus, brouillons compris. `used` : seulement ce
 * qui sert (un groupe compte dès qu'une de ses étiquettes sert). Les étiquettes à classer qui servent viennent à la fin.
 */
export async function tagFilter(tx: Tx, scope: FacetScope, { used = false } = {}): Promise<TagFilterMenu> {
  const facets = await tx.select({ id: facet.id, name: facet.name }).from(facet).where(eq(facet.scope, scope)).orderBy(asc(facet.position), asc(facet.name));
  const groups = await tx.select({ facetId: tagGroup.facetId, tagId: tagGroup.tagId }).from(tagGroup).orderBy(asc(tagGroup.position));
  const members = await tx.select({ facetId: tagMember.facetId, groupId: tagMember.groupId, tagId: tagMember.tagId }).from(tagMember);
  const names = new Map((await tx.select({ id: tag.id, name: tag.name }).from(tag)).map((row) => [row.id, row.name]));
  const links =
    scope === "artist"
      ? await tx.select({ item: artistTag.artistId, tagId: artistTag.tagId }).from(artistTag)
      : scope === "event"
        ? await tx.select({ item: eventTag.eventId, tagId: eventTag.tagId }).from(eventTag)
        : await tx.select({ item: showTag.showId, tagId: showTag.tagId }).from(showTag);
  const itemsOf = new Map<string, Set<string>>();
  for (const link of links) itemsOf.set(link.tagId, (itemsOf.get(link.tagId) ?? new Set()).add(link.item));
  const count = (...ids: string[]) => new Set(ids.flatMap((id) => [...(itemsOf.get(id) ?? [])])).size;
  const byName = (a: TagFilterOption, b: TagFilterOption) => frenchOrder.compare(a.name, b.name);

  const menu: TagFilterMenu = facets.map((one) => ({
    facet: one.name,
    options: groups
      .filter((group) => group.facetId === one.id)
      .flatMap((group) => {
        const own = members.filter((member) => member.facetId === one.id && member.groupId === group.tagId);
        const head: TagFilterOption = { id: group.tagId, name: names.get(group.tagId) ?? "", group: true, count: count(group.tagId, ...own.map((member) => member.tagId)) };
        const rest = own.map((member) => ({ id: member.tagId, name: names.get(member.tagId) ?? "", group: false, count: count(member.tagId) })).sort(byName);
        return used ? (head.count ? [head, ...rest.filter((option) => option.count)] : []) : [head, ...rest];
      }),
  }));
  const placed = new Set([...groups.map((group) => group.tagId), ...members.map((member) => member.tagId)]);
  const unplaced = [...itemsOf.keys()]
    .filter((id) => !placed.has(id))
    .map((id) => ({ id, name: names.get(id) ?? "", group: false, count: count(id) }))
    .sort(byName);
  if (unplaced.length) menu.push({ facet: "À classer", options: unplaced });
  return menu.filter((one) => one.options.length);
}

// ---------------------------------------------------------------------------------------------------------------
// Les étiquettes
// ---------------------------------------------------------------------------------------------------------------

/** Une place : au premier niveau d'un filtre (un groupe, `groupId` null), ou dans un groupe de ce filtre. */
export type TagPlace = { facetId: string; groupId: string | null };

const gone: NotSaved = { ok: false, errors: { form: "Cette étiquette n'existe plus : elle a peut-être été supprimée ou fusionnée." } };
const placeGone: NotSaved = { ok: false, errors: { form: "Ce filtre ou ce groupe n'existe plus : la page a peut-être changé entre-temps." } };

/** Le même nom, sans les accents ni les majuscules : « coupe decale » retrouve « Coupé-décalé ». */
const sameName = (name: string) => sql`private.immutable_unaccent(lower(${tag.name})) = private.immutable_unaccent(lower(${name}))`;

/** La place existe-t-elle encore ? Un groupe doit être un groupe de ce filtre. */
async function placeExists(tx: Tx, { facetId, groupId }: TagPlace): Promise<boolean> {
  if (!isUuid(facetId) || (groupId !== null && !isUuid(groupId))) return false;
  if (groupId === null) return (await tx.select({ id: facet.id }).from(facet).where(eq(facet.id, facetId)).limit(1)).length > 0;
  return (await tx.select({ id: tagGroup.tagId }).from(tagGroup).where(and(eq(tagGroup.facetId, facetId), eq(tagGroup.tagId, groupId))).limit(1)).length > 0;
}

/** Range une étiquette à cette place. Vrai si elle n'y était pas déjà. */
async function putAt(tx: Tx, tagId: string, { facetId, groupId }: TagPlace): Promise<boolean> {
  if (groupId === null) {
    const [last] = await tx.select({ position: sql<number>`coalesce(max(${tagGroup.position}), 0)`.mapWith(Number) }).from(tagGroup).where(eq(tagGroup.facetId, facetId));
    const added = await tx
      .insert(tagGroup)
      .values({ facetId, tagId, position: (last?.position ?? 0) + 1 })
      .onConflictDoNothing()
      .returning({ id: tagGroup.tagId });
    return added.length > 0;
  }
  // Un groupe n'est pas rangé dans lui-même : il vaut déjà pour lui.
  if (groupId === tagId) return false;
  const added = await tx.insert(tagMember).values({ facetId, groupId, tagId }).onConflictDoNothing().returning({ id: tagMember.tagId });
  return added.length > 0;
}

export type TagsAdded = {
  ok: true;
  /** Les étiquettes nées. */
  created: string[];
  /** Celles qui existaient déjà ailleurs, rangées ici aussi. */
  placed: string[];
  /** Celles qui étaient déjà à cette place. */
  already: string[];
};

/**
 * Ajoute des étiquettes à une place : chaque nom retrouve l'étiquette de la même adresse ou du même nom (sans les
 * accents ni les majuscules), ou en crée une. Une étiquette déjà rangée ailleurs le reste : elle gagne une place.
 */
export async function addTags(tx: Tx, where: TagPlace, names: string[]): Promise<TagsAdded | NotSaved> {
  if (!(await placeExists(tx, where))) return placeGone;
  const result: TagsAdded = { ok: true, created: [], placed: [], already: [] };
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    let [found] = await tx
      .select({ id: tag.id, name: tag.name })
      .from(tag)
      .where(or(eq(tag.slug, slug), sameName(name)))
      .orderBy(sql`${tag.slug} = ${slug} desc`)
      .limit(1);
    const born = !found;
    if (!found) [found] = await tx.insert(tag).values({ name, slug }).returning({ id: tag.id, name: tag.name });
    const put = await putAt(tx, found!.id, where);
    if (born) result.created.push(found!.name);
    else (put ? result.placed : result.already).push(found!.name);
  }
  return result;
}

/** Renomme une étiquette, ou change son adresse (celle des filtres du site : un lien déjà partagé ne mènera plus à rien). */
export async function renameTag(tx: Tx, id: string, values: { name: string; slug: string }): Promise<{ ok: true; id: string } | NotSaved> {
  if (!isUuid(id)) return gone;
  const [clash] = await tx
    .select({ name: tag.name, slug: tag.slug })
    .from(tag)
    .where(and(ne(tag.id, id), or(eq(tag.slug, values.slug), sameName(values.name))))
    .limit(1);
  if (clash)
    return {
      ok: false,
      errors:
        clash.slug === values.slug
          ? { slug: `Cette adresse sert déjà à « ${clash.name} ». Pour n'en garder qu'une, fusionne les deux étiquettes.` }
          : { name: `« ${clash.name} » existe déjà. Pour n'en garder qu'une, fusionne les deux étiquettes.` },
    };
  const [updated] = await tx.update(tag).set(values).where(eq(tag.id, id)).returning({ id: tag.id });
  return updated ? { ok: true, id } : gone;
}

/** Range une étiquette à une place de plus. */
export async function placeTag(tx: Tx, id: string, where: TagPlace): Promise<{ ok: true; added: boolean } | NotSaved> {
  if (!isUuid(id) || !(await tx.select({ id: tag.id }).from(tag).where(eq(tag.id, id)).limit(1)).length) return gone;
  if (!(await placeExists(tx, where))) return placeGone;
  return { ok: true, added: await putAt(tx, id, where) };
}

/**
 * Retire une étiquette d'une place, sans la supprimer : elle reste sur ses contenus. Retirer un groupe de son filtre
 * en retire aussi ses étiquettes, de ce groupe seulement. Rend faux si elle n'y était plus.
 */
export async function unplaceTag(tx: Tx, id: string, { facetId, groupId }: TagPlace): Promise<boolean> {
  if (!isUuid(id) || !isUuid(facetId) || (groupId !== null && !isUuid(groupId))) return false;
  const removed =
    groupId === null
      ? await tx
          .delete(tagGroup)
          .where(and(eq(tagGroup.facetId, facetId), eq(tagGroup.tagId, id)))
          .returning({ id: tagGroup.tagId })
      : await tx
          .delete(tagMember)
          .where(and(eq(tagMember.facetId, facetId), eq(tagMember.groupId, groupId), eq(tagMember.tagId, id)))
          .returning({ id: tagMember.tagId });
  return removed.length > 0;
}

/** Monte ou descend un groupe d'une place dans son filtre ; les places sont renumérotées (1, 2, 3…). */
export async function moveGroup(tx: Tx, facetId: string, id: string, direction: "up" | "down"): Promise<boolean> {
  if (!isUuid(facetId) || !isUuid(id)) return false;
  const order = await tx
    .select({ tagId: tagGroup.tagId, position: tagGroup.position })
    .from(tagGroup)
    .where(eq(tagGroup.facetId, facetId))
    .orderBy(asc(tagGroup.position))
    .for("update");
  const from = order.findIndex((group) => group.tagId === id);
  if (from < 0) return false;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to >= 0 && to < order.length) [order[from], order[to]] = [order[to]!, order[from]!];
  for (const [index, group] of order.entries())
    if (group.position !== index + 1) await tx.update(tagGroup).set({ position: index + 1 }).where(and(eq(tagGroup.facetId, facetId), eq(tagGroup.tagId, group.tagId)));
  return true;
}

/**
 * Fusionne une étiquette dans une autre : les contenus de la première passent à la seconde, qui prend aussi ses places
 * (et, là où la première était un groupe, ses étiquettes). La première disparaît. Rend les deux noms.
 */
export async function mergeTags(tx: Tx, fromId: string, intoId: string): Promise<{ ok: true; from: string; into: string } | NotSaved> {
  if (!isUuid(fromId) || !isUuid(intoId)) return gone;
  if (fromId === intoId) return { ok: false, errors: { into: "Choisis une autre étiquette que celle-ci." } };
  const both = await tx.select({ id: tag.id, name: tag.name }).from(tag).where(inArray(tag.id, [fromId, intoId])).for("update");
  const from = both.find((one) => one.id === fromId);
  const into = both.find((one) => one.id === intoId);
  if (!from) return gone;
  if (!into) return { ok: false, errors: { into: "L'étiquette choisie n'existe plus." } };
  const target = sql`${intoId}::uuid`;
  const source = sql`${fromId}::uuid`;
  await tx.execute(sql`insert into ${showTag} (show_id, tag_id) select show_id, ${target} from ${showTag} where tag_id = ${source} on conflict do nothing`);
  await tx.execute(sql`insert into ${artistTag} (artist_id, tag_id) select artist_id, ${target} from ${artistTag} where tag_id = ${source} on conflict do nothing`);
  await tx.execute(sql`insert into ${eventTag} (event_id, tag_id) select event_id, ${target} from ${eventTag} where tag_id = ${source} on conflict do nothing`);
  // Ses places de groupe, puis les étiquettes de ces groupes, puis ses places dans des groupes.
  await tx.execute(sql`insert into ${tagGroup} (facet_id, tag_id, position) select facet_id, ${target}, position from ${tagGroup} where tag_id = ${source} on conflict do nothing`);
  await tx.execute(
    sql`insert into ${tagMember} (facet_id, group_id, tag_id) select facet_id, ${target}, tag_id from ${tagMember} where group_id = ${source} and tag_id <> ${target} on conflict do nothing`,
  );
  await tx.execute(
    sql`insert into ${tagMember} (facet_id, group_id, tag_id) select facet_id, group_id, ${target} from ${tagMember} where tag_id = ${source} and group_id <> ${target} on conflict do nothing`,
  );
  await tx.delete(tag).where(eq(tag.id, fromId));
  return { ok: true, from: from.name, into: into.name };
}

/** Supprime une étiquette : elle quitte ses places et ses contenus. Rend son nom, ou null si elle n'existait plus. */
export async function deleteTag(tx: Tx, id: string): Promise<{ name: string } | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(tag).where(eq(tag.id, id)).returning({ name: tag.name });
  return removed ?? null;
}

/** Supprime les étiquettes à classer qui ne servent à rien : sans place, sans show, sans artiste, sans événement. */
export async function deleteUnusedTags(tx: Tx): Promise<number> {
  const removed = await tx
    .delete(tag)
    .where(
      sql`not exists (select 1 from ${tagGroup} g where g.tag_id = ${outer(tag.id)})
        and not exists (select 1 from ${tagMember} m where m.tag_id = ${outer(tag.id)})
        and not exists (select 1 from ${showTag} st where st.tag_id = ${outer(tag.id)})
        and not exists (select 1 from ${artistTag} ag where ag.tag_id = ${outer(tag.id)})
        and not exists (select 1 from ${eventTag} et where et.tag_id = ${outer(tag.id)})`,
    )
    .returning({ id: tag.id });
  return removed.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Les filtres
// ---------------------------------------------------------------------------------------------------------------

const facetGone: NotSaved = { ok: false, errors: { form: "Ce filtre n'existe plus : il a peut-être été supprimé." } };

/**
 * Crée un filtre (à la fin de la liste) ou le modifie. Ce qu'il range (shows, artistes, événements) ne change plus
 * après sa création : ses étiquettes sont déjà posées sur ces contenus.
 */
export async function saveFacet(tx: Tx, { id, values }: { id?: string; values: FacetValues }): Promise<{ ok: true; id: string } | NotSaved> {
  if (id !== undefined && !isUuid(id)) return facetGone;
  const [clash] = await tx
    .select({ name: facet.name })
    .from(facet)
    .where(and(eq(facet.slug, values.slug), id ? ne(facet.id, id) : undefined))
    .limit(1);
  if (clash) return { ok: false, errors: { slug: `Cette adresse sert déjà au filtre « ${clash.name} ».` } };
  if (id) {
    const [current] = await tx.select({ scope: facet.scope }).from(facet).where(eq(facet.id, id)).for("update");
    if (!current) return facetGone;
    await tx
      .update(facet)
      .set({ name: values.name, slug: values.slug, description: values.description, showTypes: current.scope === "show" ? values.showTypes : [] })
      .where(eq(facet.id, id));
    return { ok: true, id };
  }
  const [last] = await tx.select({ position: sql<number>`coalesce(max(${facet.position}), 0)`.mapWith(Number) }).from(facet);
  const [created] = await tx
    .insert(facet)
    .values({ ...values, position: (last?.position ?? 0) + 1 })
    .returning({ id: facet.id });
  return { ok: true, id: created!.id };
}

/** Monte ou descend un filtre d'une place ; les places sont renumérotées. */
export async function moveFacet(tx: Tx, id: string, direction: "up" | "down"): Promise<boolean> {
  if (!isUuid(id)) return false;
  const order = await tx.select({ id: facet.id, position: facet.position }).from(facet).orderBy(asc(facet.position), asc(facet.name)).for("update");
  const from = order.findIndex((one) => one.id === id);
  if (from < 0) return false;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to >= 0 && to < order.length) [order[from], order[to]] = [order[to]!, order[from]!];
  for (const [index, one] of order.entries()) if (one.position !== index + 1) await tx.update(facet).set({ position: index + 1 }).where(eq(facet.id, one.id));
  return true;
}

/** Supprime un filtre et ses places. Ses étiquettes restent, sur leurs contenus ; celles qui n'ont plus de place sont à classer. */
export async function deleteFacet(tx: Tx, id: string): Promise<{ name: string } | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(facet).where(eq(facet.id, id)).returning({ name: facet.name });
  return removed ?? null;
}
