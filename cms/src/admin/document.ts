/**
 * Le document « Tags et filtres site web » (un export Markdown de Google Docs) appliqué au classement des étiquettes :
 * le lire, puis rendre les filtres qu'il décrit conformes à ce qu'il dit, d'un coup.
 *
 * Le document fait foi pour les filtres qu'il décrit (Thème, Genre, Géographie, Activité, Catégorie) : leurs groupes,
 * dans son ordre, et les étiquettes de chaque groupe. Une étiquette se retrouve par son adresse : celle d'avant garde
 * ses contenus, et prend le nom du document s'il change autrement que par la casse. Ce que le document ne nomme plus
 * quitte ces filtres : une étiquette qui ne sert à rien est supprimée, une étiquette posée sur des contenus reste, à
 * classer — ou change de nom si on le demande (`renames` : « Detroit techno » devient « Techno de Détroit »). Un filtre
 * que le document ne décrit pas n'est pas touché.
 *
 * La lecture du document suit sa mise en forme : titres # (rubrique : Émissions, Résidents, Événements), ## et ### ;
 * dans Genre et Géographie, un passage en gras est un groupe et les noms qui suivent, séparés par des virgules, sont
 * ses étiquettes ; une étiquette qui porte le nom de son groupe n'y est pas recopiée ; tout s'arrête à « À propos » ou
 * à « POUBELLE ». Les noms passent des capitales aux minuscules (tidyTagName).
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { outer } from "../read/common.ts";
import { artistTag, eventTag, facet, showTag, tag, tagGroup, tagMember, type FacetScope, type ShowType } from "../schema.ts";
import { slugify } from "../slug.ts";
import type { NotSaved } from "./common.ts";
import { isUuid, tidyTagName } from "./input.ts";
import { mergeTags } from "./tags.ts";

// ---------------------------------------------------------------------------------------------------------------
// Lire le document
// ---------------------------------------------------------------------------------------------------------------

export type DocumentFacet = { slug: string; name: string; scope: FacetScope; showTypes: ShowType[]; groups: { name: string; members: string[] }[] };
/** Ce que dit le document, et ce qu'on n'a pas su y lire. */
export type TagDocument = { facets: DocumentFacet[]; problems: string[] };

/** Les filtres que nomme le document, tels qu'ils sont dans la base. */
const FACETS = {
  theme: { slug: "theme", name: "Thème", scope: "show", showTypes: ["podcast"] },
  genre: { slug: "genre", name: "Genre", scope: "show", showTypes: ["dj_set", "playlist"] },
  geographie: { slug: "geographie", name: "Géographie", scope: "show", showTypes: ["dj_set", "playlist"] },
  activite: { slug: "activite", name: "Activité", scope: "artist", showTypes: [] },
  categorie: { slug: "categorie", name: "Catégorie", scope: "event", showTypes: [] },
} satisfies Record<string, Omit<DocumentFacet, "groups">>;

/** Un titre comparable : sans gras, sans flèche, sans accents, en capitales. */
const key = (text: string) =>
  text
    .replace(/\*\*/g, "")
    .replace(/\\([+_*#])/g, "$1")
    .replace(/^[\s→>-]+/, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

/** Lit le document des filtres. Ne lève jamais d'erreur : ce qui ne se lit pas va dans `problems`. */
export function readTagDocument(markdown: string): TagDocument {
  const facets = new Map<string, DocumentFacet>();
  const problems: string[] = [];
  const facetOf = (base: Omit<DocumentFacet, "groups">) => {
    if (!facets.has(base.slug)) facets.set(base.slug, { ...base, showTypes: [...base.showTypes], groups: [] });
    return facets.get(base.slug)!;
  };
  const groupOf = (into: DocumentFacet, raw: string) => {
    const name = tidyTagName(raw, { capitals: true });
    if (!slugify(name)) return null;
    const found = into.groups.find((group) => slugify(group.name) === slugify(name));
    if (found) return found;
    const made = { name, members: [] as string[] };
    into.groups.push(made);
    return made;
  };
  const memberOf = (group: { name: string; members: string[] }, raw: string) => {
    const name = tidyTagName(raw, { capitals: true });
    const slug = slugify(name);
    // Une étiquette du nom de son groupe (SOUL dans SOUL) : le groupe se choisit lui-même.
    if (!slug || slug === slugify(group.name) || group.members.some((one) => slugify(one) === slug)) return;
    group.members.push(name);
  };

  let section = "";
  let sub = "";
  let current: DocumentFacet | null = null;
  let group: { name: string; members: string[] } | null = null;
  // « lines » : une étiquette par ligne (les thèmes) ; « bold » : groupes en gras, étiquettes en liste (genres, régions).
  let mode: "" | "lines" | "bold" = "";

  for (const raw of markdown.normalize("NFC").split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (key(line) === "POUBELLE") break;
    const heading = line.match(/^(#{1,6})\s*(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const title = key(heading[2]!);
      mode = "";
      group = null;
      if (!title) continue;
      if (level === 1) {
        if (title === "A PROPOS") break;
        section = title === "EMISSIONS" ? "emissions" : title === "RESIDENTS" ? "residents" : title === "EVENEMENTS" ? "events" : "";
        sub = "";
        if (!section && !title.startsWith("TAGS ET FILTRES")) problems.push(`Rubrique inconnue, laissée de côté : « ${heading[2]!.replace(/\*\*/g, "").trim()} ».`);
        continue;
      }
      if (level === 2) {
        if (section === "emissions") sub = title === "PODCAST" ? "podcast" : title.startsWith("PLAYLIST") ? "music" : "";
        if (section === "emissions" && !sub) problems.push(`Partie inconnue des émissions, laissée de côté : « ${heading[2]!.replace(/\*\*/g, "").trim()} ».`);
        continue;
      }
      // Niveau 3 et plus.
      const name = heading[2]!.replace(/\*\*/g, "").replace(/^[\s→>-]+/, "");
      if (section === "emissions" && sub === "podcast") {
        current = facetOf(FACETS.theme);
        group = groupOf(current, name);
        mode = "lines";
      } else if (section === "emissions" && sub === "music") {
        if (title === "MOOD") continue; // l'échelle calme → énergique : le mood des shows, pas des étiquettes
        current =
          title === "GENRE"
            ? facetOf(FACETS.genre)
            : title === "GEOGRAPHIE"
              ? facetOf(FACETS.geographie)
              : facetOf({ ...FACETS.genre, slug: slugify(name), name: tidyTagName(name, { capitals: true }) });
        mode = "bold";
      } else if (section === "residents") groupOf(facetOf(FACETS.activite), name);
      else if (section === "events") groupOf(facetOf(FACETS.categorie), name);
      continue;
    }
    if (mode === "lines" && group) {
      memberOf(group, line);
      continue;
    }
    if (mode !== "bold" || !current) continue;
    for (const part of line.split(/(\*\*[^*]+\*\*)/).filter((piece) => piece.trim())) {
      if (part.startsWith("**")) {
        // Le séparateur « —----- » n'est pas un groupe.
        if (/^[-—–\s]*$/.test(part.slice(2, -2))) continue;
        group = groupOf(current, part.slice(2, -2));
        continue;
      }
      if (!group) {
        problems.push(`Des étiquettes sans groupe dans ${current.name}, laissées de côté : « ${part.trim().slice(0, 60)} ».`);
        continue;
      }
      for (const item of part.split(",")) memberOf(group, item);
    }
  }
  return { facets: [...facets.values()], problems };
}

// ---------------------------------------------------------------------------------------------------------------
// L'appliquer
// ---------------------------------------------------------------------------------------------------------------

/** Ce qui change dans un filtre. */
export type FacetChanges = {
  name: string;
  /** Le filtre n'existait pas : il naît. */
  created: boolean;
  addedGroups: string[];
  removedGroups: string[];
  /** Les groupes qui restent changent d'ordre. */
  reordered: boolean;
  /** Les groupes dont les étiquettes changent (les nouveaux compris) : celles qui y entrent, celles qui en sortent. */
  groups: { name: string; added: string[]; removed: string[] }[];
};

/** Une étiquette que le document ne nomme plus mais qui sert : gardée, à classer, et peut-être un nom proposé. */
export type KeptTag = { id: string; name: string; shows: number; artists: number; events: number; suggestion: string | null };

export type DocumentChanges = {
  ok: true;
  /** Ce que le document décrit. */
  described: { facets: string[]; groups: number; tags: number };
  /** Les filtres qui changent. */
  facets: FacetChanges[];
  created: string[];
  renamed: { from: string; to: string }[];
  /** Ne sont plus dans le document, et ne servaient à rien. */
  deleted: string[];
  kept: KeptTag[];
  problems: string[];
  /** Rien ne change. */
  unchanged: boolean;
};

/** Un renommage demandé : une étiquette d'avant prend un nom du document, et garde ses contenus. */
export type DocumentRename = { id: string; to: string };

const STOP_WORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l"]);
const words = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !STOP_WORDS.has(word));

/** À quel point deux noms se ressemblent, de 0 à 1 : les mots en commun (« minimal » vaut « minimale »). */
function likeness(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.length || !right.length) return 0;
  const same = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const shared = left.filter((word) => right.some((other) => same(word, other))).length;
  return shared / Math.max(left.length, right.length);
}

/**
 * Rend le classement conforme au document, dans la transaction donnée, et dit ce qui a changé. Pour un aperçu, la
 * transaction est annulée ensuite (src/admin/index.ts) : l'aperçu est exactement ce que fera l'import.
 */
export async function syncTagDocument(tx: Tx, doc: TagDocument, { renames = [] }: { renames?: DocumentRename[] } = {}): Promise<DocumentChanges | NotSaved> {
  if (!doc.facets.length)
    return { ok: false, errors: { document: "Ce texte ne ressemble pas au document des filtres : aucune rubrique reconnue (ÉMISSIONS, RÉSIDENTS, ÉVÉNEMENTS)." } };
  const changes: DocumentChanges = {
    ok: true,
    described: { facets: doc.facets.map((one) => one.name), groups: 0, tags: 0 },
    facets: [],
    created: [],
    renamed: [],
    deleted: [],
    kept: [],
    problems: [...doc.problems],
    unchanged: true,
  };

  // Avant tout : ce qui est rangé dans les filtres du document, pour savoir ce qui en sortira.
  const facetRows = await tx.select({ id: facet.id, slug: facet.slug, name: facet.name, position: facet.position }).from(facet);
  const touched = facetRows.filter((row) => doc.facets.some((one) => one.slug === row.slug)).map((row) => row.id);
  const placedBefore = new Set(
    touched.length
      ? [
          ...(await tx.select({ id: tagGroup.tagId }).from(tagGroup).where(inArray(tagGroup.facetId, touched))).map((row) => row.id),
          ...(await tx.select({ id: tagMember.tagId }).from(tagMember).where(inArray(tagMember.facetId, touched))).map((row) => row.id),
        ]
      : [],
  );

  // 1. Les renommages demandés : l'étiquette garde ses contenus ; si le nouveau nom existe déjà, elle s'y fond.
  for (const rename of renames) {
    const name = tidyTagName(rename.to ?? "");
    const slug = slugify(name);
    if (!isUuid(rename.id) || !slug) continue;
    const [current] = await tx.select({ id: tag.id, name: tag.name }).from(tag).where(eq(tag.id, rename.id)).limit(1);
    if (!current) continue;
    const [taken] = await tx
      .select({ id: tag.id })
      .from(tag)
      .where(and(eq(tag.slug, slug), ne(tag.id, current.id)))
      .limit(1);
    if (taken) await mergeTags(tx, current.id, taken.id);
    else await tx.update(tag).set({ name, slug }).where(eq(tag.id, current.id));
    changes.renamed.push({ from: current.name, to: name });
  }

  // 2. Les étiquettes du document, retrouvées par leur adresse ou créées. Un nom qui change autrement que par la casse
  // suit le document (« Pop, variété » → « Pop & variété ») ; la casse retouchée dans l'admin reste.
  const wanted = new Map<string, string>();
  for (const one of doc.facets) for (const group of one.groups) for (const name of [group.name, ...group.members]) if (!wanted.has(slugify(name))) wanted.set(slugify(name), name);
  const existing = new Map((await tx.select({ id: tag.id, name: tag.name, slug: tag.slug }).from(tag)).map((row) => [row.slug, row]));
  const idOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const fresh: { name: string; slug: string }[] = [];
  for (const [slug, name] of wanted) {
    const found = existing.get(slug);
    if (!found) {
      fresh.push({ name, slug });
      continue;
    }
    idOf.set(slug, found.id);
    nameOf.set(found.id, found.name);
    if (found.name.toLocaleLowerCase("fr") !== name.toLocaleLowerCase("fr")) {
      await tx.update(tag).set({ name }).where(eq(tag.id, found.id));
      changes.renamed.push({ from: found.name, to: name });
      nameOf.set(found.id, name);
    }
  }
  if (fresh.length) {
    const born = await tx.insert(tag).values(fresh).returning({ id: tag.id, name: tag.name, slug: tag.slug });
    for (const row of born) {
      idOf.set(row.slug, row.id);
      nameOf.set(row.id, row.name);
      changes.created.push(row.name);
    }
  }
  // Les noms d'avant, pour dire ce qui sort d'un groupe.
  const allNames = new Map((await tx.select({ id: tag.id, name: tag.name }).from(tag)).map((row) => [row.id, row.name]));
  const label = (id: string) => allNames.get(id) ?? nameOf.get(id) ?? "?";

  // 3. Chaque filtre : ses groupes dans l'ordre du document, et les étiquettes de chaque groupe.
  let lastPosition = Math.max(0, ...facetRows.map((row) => row.position));
  for (const described of doc.facets) {
    const report: FacetChanges = { name: described.name, created: false, addedGroups: [], removedGroups: [], reordered: false, groups: [] };
    let row = facetRows.find((one) => one.slug === described.slug);
    if (!row) {
      const [made] = await tx
        .insert(facet)
        .values({ slug: described.slug, name: described.name, scope: described.scope, showTypes: described.showTypes, position: ++lastPosition })
        .returning({ id: facet.id, slug: facet.slug, name: facet.name, position: facet.position });
      row = made!;
      report.created = true;
    }
    report.name = row.name;
    const facetId = row.id;
    const groupsNow = await tx.select({ tagId: tagGroup.tagId, position: tagGroup.position }).from(tagGroup).where(eq(tagGroup.facetId, facetId)).orderBy(asc(tagGroup.position));
    const membersNow = await tx.select({ groupId: tagMember.groupId, tagId: tagMember.tagId }).from(tagMember).where(eq(tagMember.facetId, facetId));
    const target = described.groups.map((group) => {
      const id = idOf.get(slugify(group.name))!;
      return { id, members: [...new Set(group.members.map((name) => idOf.get(slugify(name))!))].filter((member) => member !== id) };
    });
    changes.described.groups += target.length;

    // Les groupes que le document ne nomme plus : retirés, avec leurs étiquettes de ce groupe.
    const gone = groupsNow.filter((now) => !target.some((group) => group.id === now.tagId));
    if (gone.length) {
      await tx.delete(tagGroup).where(and(eq(tagGroup.facetId, facetId), inArray(tagGroup.tagId, gone.map((now) => now.tagId))));
      report.removedGroups = gone.map((now) => label(now.tagId));
    }
    const keptBefore = groupsNow.filter((now) => target.some((group) => group.id === now.tagId)).map((now) => now.tagId);
    const keptAfter = target.filter((group) => groupsNow.some((now) => now.tagId === group.id)).map((group) => group.id);
    report.reordered = keptBefore.join() !== keptAfter.join();
    for (const [index, group] of target.entries()) {
      const now = groupsNow.find((one) => one.tagId === group.id);
      if (!now) {
        await tx.insert(tagGroup).values({ facetId, tagId: group.id, position: index + 1 });
        report.addedGroups.push(label(group.id));
      } else if (now.position !== index + 1) await tx.update(tagGroup).set({ position: index + 1 }).where(and(eq(tagGroup.facetId, facetId), eq(tagGroup.tagId, group.id)));
      // Ses étiquettes : un groupe tout neuf n'en a pas encore.
      const inside = now ? membersNow.filter((member) => member.groupId === group.id).map((member) => member.tagId) : [];
      const added = group.members.filter((id) => !inside.includes(id));
      const removed = inside.filter((id) => !group.members.includes(id));
      if (removed.length) await tx.delete(tagMember).where(and(eq(tagMember.facetId, facetId), eq(tagMember.groupId, group.id), inArray(tagMember.tagId, removed)));
      if (added.length) await tx.insert(tagMember).values(added.map((tagId) => ({ facetId, groupId: group.id, tagId })));
      if (added.length || removed.length) report.groups.push({ name: label(group.id), added: added.map(label), removed: removed.map(label) });
    }
    if (report.created || report.addedGroups.length || report.removedGroups.length || report.reordered || report.groups.length) changes.facets.push(report);
  }
  changes.described.tags = wanted.size;

  // 4. Ce qui sort du document : supprimé si ça ne sert à rien, gardé à classer sinon.
  const inDocument = new Set(idOf.values());
  const leaving = [...placedBefore].filter((id) => !inDocument.has(id));
  if (leaving.length) {
    const rows = await tx
      .select({
        id: tag.id,
        name: tag.name,
        placed: sql<boolean>`exists (select 1 from ${tagGroup} g where g.tag_id = ${outer(tag.id)}) or exists (select 1 from ${tagMember} m where m.tag_id = ${outer(tag.id)})`,
        shows: sql<number>`(select count(*) from ${showTag} l where l.tag_id = ${outer(tag.id)})`.mapWith(Number),
        artists: sql<number>`(select count(*) from ${artistTag} l where l.tag_id = ${outer(tag.id)})`.mapWith(Number),
        events: sql<number>`(select count(*) from ${eventTag} l where l.tag_id = ${outer(tag.id)})`.mapWith(Number),
      })
      .from(tag)
      .where(inArray(tag.id, leaving));
    const orphans = rows.filter((row) => !row.placed);
    const unused = orphans.filter((row) => !row.shows && !row.artists && !row.events);
    if (unused.length) {
      await tx.delete(tag).where(inArray(tag.id, unused.map((row) => row.id)));
      changes.deleted = unused.map((row) => row.name);
    }
    changes.kept = orphans
      .filter((row) => row.shows || row.artists || row.events)
      .map(({ placed: _placed, ...row }) => {
        const best = changes.created.map((name) => ({ name, score: likeness(row.name, name) })).sort((a, b) => b.score - a.score)[0];
        return { ...row, suggestion: best && best.score >= 0.5 ? best.name : null };
      });
  }

  const byName = (a: string, b: string) => a.localeCompare(b, "fr");
  changes.created.sort(byName);
  changes.deleted.sort(byName);
  changes.unchanged = !changes.facets.length && !changes.created.length && !changes.renamed.length && !changes.deleted.length && !changes.kept.length;
  return changes;
}
