/**
 * Les étiquettes et les filtres : ce que la migration 0007 inscrit (le document « Tags et filtres site web ») et ce
 * qu'elle reprend d'avant, la saisie des noms, puis le classement dans l'admin, sous le rôle d'un éditeur.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, readFacetForm, readTagForm, readTagNames, tidyTagName, type Admin, type Taxonomy } from "../src/admin/index.ts";
import { MIGRATIONS_FOLDER, type Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { facet, show, showTag, tag } from "../src/schema.ts";
import { createAccount, exampleDb, freshDb, MEDIA_BASE, rowsOf } from "./helpers.ts";

/** Les noms d'un groupe, lus par le propriétaire : le filtre, le groupe, puis ses étiquettes. */
async function groupOf(connection: Connection, facetSlug: string, groupSlug: string): Promise<string[]> {
  const rows = rowsOf<{ name: string }>(
    await connection.db.execute(sql`select t.name from tag_member m join facet f on f.id = m.facet_id join tag g on g.id = m.group_id join tag t on t.id = m.tag_id
      where f.slug = ${facetSlug} and g.slug = ${groupSlug} order by t.name`),
  );
  return rows.map((row) => row.name);
}

describe("le document des filtres, inscrit par la migration", () => {
  let connection: Connection;
  beforeAll(async () => {
    connection = await freshDb();
  });
  afterAll(() => connection.close());

  it("range 351 étiquettes en 5 filtres et 30 groupes, dans l'ordre du document", async () => {
    const facets = rowsOf<{ slug: string; name: string; scope: string; show_types: string; groups: number; members: number }>(
      await connection.db.execute(sql`select f.slug, f.name, f.scope, f.show_types::text as show_types,
          (select count(*)::int from tag_group g where g.facet_id = f.id) as groups,
          (select count(*)::int from tag_member m where m.facet_id = f.id) as members
        from facet f order by f.position`),
    );
    expect(facets).toEqual([
      { slug: "theme", name: "Thème", scope: "show", show_types: "{podcast}", groups: 3, members: 17 },
      { slug: "genre", name: "Genre", scope: "show", show_types: "{dj_set,playlist}", groups: 14, members: 82 },
      { slug: "geographie", name: "Géographie", scope: "show", show_types: "{dj_set,playlist}", groups: 5, members: 228 },
      { slug: "activite", name: "Activité", scope: "artist", show_types: "{}", groups: 3, members: 0 },
      { slug: "categorie", name: "Catégorie", scope: "event", show_types: "{}", groups: 5, members: 0 },
    ]);
    const [tags] = rowsOf<{ n: number }>(await connection.db.execute(sql`select count(*)::int as n from tag`));
    expect(tags!.n).toBe(351);
    const genre = rowsOf<{ name: string }>(
      await connection.db.execute(sql`select t.name from tag_group g join facet f on f.id = g.facet_id join tag t on t.id = g.tag_id where f.slug = 'genre' order by g.position`),
    );
    expect(genre.map((row) => row.name)).toEqual([
      "Classique",
      "Pop, variété",
      "Jazz",
      "Hip-hop, R'n'B",
      "Soul",
      "Disco",
      "Rock",
      "Metal, alternative rock",
      "Ambient",
      "Électronique, downtempo",
      "Club",
      "House / techno",
      "Live performance, art ensemble",
      "Talk, poésie, soundtracks",
    ]);
  });

  it("met une étiquette à toutes ses places, et un groupe jamais dans lui-même", async () => {
    const places = rowsOf<{ name: string; places: string }>(
      await connection.db.execute(sql`select t.name, string_agg(f.name || ' › ' || g.name, ' ; ' order by f.position, g.name) as places
        from tag_member m join tag t on t.id = m.tag_id join facet f on f.id = m.facet_id join tag g on g.id = m.group_id
        group by t.name having count(*) > 1 order by t.name`),
    );
    expect(places).toEqual([
      { name: "Amapiano", places: "Genre › Club ; Géographie › Afrique / Moyen-Orient" },
      { name: "Baile funk", places: "Genre › Club ; Géographie › Amérique latine / Brésil" },
      { name: "Coupé-décalé", places: "Genre › Club ; Géographie › Afrique / Moyen-Orient" },
      { name: "Gqom", places: "Genre › Club ; Géographie › Afrique / Moyen-Orient" },
      { name: "Kaseko", places: "Géographie › Amérique latine / Brésil ; Géographie › Caraïbes" },
      { name: "Singeli", places: "Genre › Club ; Géographie › Afrique / Moyen-Orient" },
    ]);
    // SOUL dans SOUL, CLUB dans CLUB : le groupe se choisit lui-même.
    expect(await groupOf(connection, "genre", "soul")).toEqual(["Blues", "Funk", "Gospel", "Rhythm & blues"]);
    expect(await groupOf(connection, "genre", "club")).not.toContain("Club");
    expect(await groupOf(connection, "genre", "hip-hop-r-n-b")).toEqual(["Drill", "Rap", "RnB", "Trap"]);
  });

  it("écrit les noms en minuscules, sigles et noms propres gardés", async () => {
    const names = rowsOf<{ slug: string; name: string }>(
      await connection.db.execute(sql`select slug, name from tag where slug in ('uk-funky', 'k-pop', 'detroit-techno', 'folk-du-rajasthan', 'musique-indigene-d-amerique-du-sud', 'live-session-art-ensemble', 'dj', 'cai-luong') order by slug`),
    );
    expect(Object.fromEntries(names.map((row) => [row.slug, row.name]))).toEqual({
      "cai-luong": "Cải lương",
      "detroit-techno": "Detroit techno",
      dj: "DJ",
      "folk-du-rajasthan": "Folk du Rajasthan",
      "k-pop": "K-pop",
      "live-session-art-ensemble": "Live session_Art ensemble",
      "musique-indigene-d-amerique-du-sud": "Musique indigène d'Amérique du Sud",
      "uk-funky": "UK funky",
    });
  });
});

describe("la reprise de l'existant", () => {
  it("garde les étiquettes d'avant, une par adresse, et fait des catégories d'événements des étiquettes", async () => {
    // Une base arrêtée avant les données des filtres (0006 appliquée, pas 0007 ni 0008), avec des contenus d'avant.
    const folder = mkdtempSync(join(tmpdir(), "parabole-cms-avant-"));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalFile = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag <= "0006");
    writeFileSync(journalFile, JSON.stringify(journal));
    const before = await freshDb({ migrationsFolder: folder });
    try {
      const { db } = before;
      await db.execute(sql`insert into tag (kind, name, slug) values ('genre', 'house', 'house'), ('genre', 'Ambient', 'ambient'),
        ('mood', 'ambient', 'ambient'), ('mood', 'Calme', 'calme'), ('theme', 'Quartier', 'quartier')`);
      await db.execute(sql`insert into show (slug, title, type) values ('ancien-show', 'Ancien show', 'dj_set')`);
      await db.execute(sql`insert into show_tag (show_id, tag_id) select s.id, t.id from show s, tag t where s.slug = 'ancien-show' and t.slug in ('house', 'ambient', 'calme')`);
      await db.execute(sql`insert into event (slug, title, category, starts_at) values
        ('a', 'A', 'art_ensemble', now()), ('b', 'B', 'parabole', now()), ('c', 'C', 'special', now()), ('d', 'D', 'talk', now())`);

      await before.migrate(MIGRATIONS_FOLDER);

      // « ambient » n'est plus qu'une étiquette, rangée dans Genre, qui garde le show ; « house » prend le nom du document.
      const tags = rowsOf<{ slug: string; name: string }>(await db.execute(sql`select slug, name from tag where slug in ('house', 'ambient', 'calme', 'quartier') order by slug`));
      expect(tags).toEqual([
        { slug: "ambient", name: "Ambient" },
        { slug: "calme", name: "Calme" },
        { slug: "house", name: "House" },
        { slug: "quartier", name: "Quartier" },
      ]);
      const onShow = rowsOf<{ slug: string }>(await db.execute(sql`select t.slug from show_tag st join tag t on t.id = st.tag_id order by t.slug`));
      expect(onShow.map((row) => row.slug)).toEqual(["ambient", "calme", "house"]);
      expect(await groupOf(before, "genre", "house-techno")).toContain("House");
      // Celles que le document ne connaît pas restent, à classer.
      const unplaced = rowsOf<{ slug: string }>(
        await db.execute(sql`select slug from tag t where not exists (select 1 from tag_group g where g.tag_id = t.id)
          and not exists (select 1 from tag_member m where m.tag_id = t.id) order by slug`),
      );
      expect(unplaced.map((row) => row.slug)).toEqual(["calme", "quartier"]);
      const [count] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from tag`));
      expect(count!.n).toBe(353);
      // Les catégories d'événements : Art ensemble → Live session, Parabole → Fête, Special → Événement spécial, Talk → Rencontre/Talk.
      const events = rowsOf<{ slug: string; tag: string }>(await db.execute(sql`select e.slug, t.slug as tag from event e join event_tag et on et.event_id = e.id join tag t on t.id = et.tag_id order by e.slug`));
      expect(events).toEqual([
        { slug: "a", tag: "live-session-art-ensemble" },
        { slug: "b", tag: "fete" },
        { slug: "c", tag: "evenement-special" },
        { slug: "d", tag: "rencontre-talk" },
      ]);
      const columns = rowsOf<{ column_name: string }>(
        await db.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'tag' and column_name = 'kind') or (table_name = 'event' and column_name = 'category'))`),
      );
      expect(columns).toEqual([]);
    } finally {
      await before.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("les noms d'étiquettes, vérifiés", () => {
  it("nettoient un texte copié du document, et ne passent en minuscules que les listes en capitales", () => {
    expect(tidyTagName("  **CLUB**  ")).toBe("CLUB");
    expect(tidyTagName("LIVE SESSION\\_ART ENSEMBLE")).toBe("LIVE SESSION_ART ENSEMBLE");
    expect(tidyTagName("HIP-HOP, R’N'B,", { capitals: true })).toBe("Hip-hop, R'n'B");
    expect(tidyTagName("UK FUNKY", { capitals: true })).toBe("UK funky");
    expect(tidyTagName("K-POP", { capitals: true })).toBe("K-pop");
    expect(tidyTagName("POP DES BALKANS", { capitals: true })).toBe("Pop des Balkans");
    expect(tidyTagName("Afro House", { capitals: true })).toBe("Afro House");
  });

  it("lisent une liste collée : séparateurs, doublons, longueur", () => {
    expect(readTagNames("AFRO HOUSE, AFROBEATS,\nAMAPIANO ;  ; afro-house").names).toEqual(["Afro house", "Afrobeats", "Amapiano"]);
    expect(readTagNames("NTS").names).toEqual(["NTS"]);
    expect(readTagNames(" , ;").errors.names).toBe("Écris un nom d'étiquette.");
    expect(readTagNames("…").errors.names).toBe("« … » : ajoute au moins une lettre ou un chiffre.");
    expect(readTagNames("x".repeat(61)).errors.names).toMatch(/60 caractères au plus/);
  });

  it("vérifient un nom renommé, et l'adresse d'un filtre", () => {
    expect(readTagForm({ name: "  Coupé   décalé ", slug: "" })).toEqual({ values: { name: "Coupé décalé", slug: "coupe-decale" }, errors: {} });
    expect(readTagForm({ name: "Kizomba", slug: "Ma Kizomba" }).values.slug).toBe("ma-kizomba");
    expect(readTagForm({ name: "", slug: "" }).errors.name).toBe("Le nom est obligatoire.");
    expect(readFacetForm({ name: "Langue", slug: "", scope: "show", showTypes: ["podcast", "inconnu"], description: "" }).values).toEqual({
      name: "Langue",
      slug: "langue",
      scope: "show",
      showTypes: ["podcast"],
      description: null,
    });
    expect(readFacetForm({ name: "Ville", slug: "", scope: "artist", showTypes: ["podcast"], description: "" }).values.showTypes).toEqual([]);
    expect(readFacetForm({ name: "", slug: "", scope: "radio", showTypes: [], description: "" }).errors).toEqual({ name: expect.any(String), scope: expect.any(String) });
  });
});

describe("le classement dans l'admin", () => {
  let connection: Connection;
  let editor: Admin;
  let stranger: Admin;

  beforeAll(async () => {
    connection = await exampleDb();
    editor = createAdmin(connection.db, await createAccount(connection.db, "editor"));
    stranger = createAdmin(connection.db, await createAccount(connection.db));
  });
  afterAll(() => connection.close());

  const facetId = async (slug: string) => (await connection.db.select({ id: facet.id }).from(facet).where(eq(facet.slug, slug)))[0]!.id;
  const tagId = async (slug: string) => (await connection.db.select({ id: tag.id }).from(tag).where(eq(tag.slug, slug)))[0]!.id;
  const nameOf = (taxonomy: Taxonomy, id: string) => taxonomy.tags.find((one) => one.id === id)?.name;
  const membersOf = async (facetSlug: string, groupSlug: string) => {
    const taxonomy = await editor.taxonomy();
    const group = taxonomy.facets.find((one) => one.slug === facetSlug)?.groups.find((one) => one.tagId === taxonomy.tags.find((t) => t.slug === groupSlug)?.id);
    return group?.members.map((id) => nameOf(taxonomy, id)) ?? null;
  };

  it("rend tout le classement : filtres dans l'ordre, groupes, étiquettes, et ce qui les porte", async () => {
    const taxonomy = await editor.taxonomy();
    expect(taxonomy.facets.map((one) => one.slug)).toEqual(["theme", "genre", "geographie", "activite", "categorie"]);
    expect(taxonomy.tags.length).toBe(353);
    const techno = taxonomy.tags.find((one) => one.slug === "techno")!;
    expect(techno).toMatchObject({ name: "Techno", shows: 3, artists: 0, events: 0 });
    expect(taxonomy.tags.find((one) => one.slug === "dj")).toMatchObject({ artists: 5 });
    expect(taxonomy.tags.find((one) => one.slug === "fete")).toMatchObject({ events: 3 });
    const club = taxonomy.facets[1]!.groups.find((group) => group.tagId === taxonomy.tags.find((one) => one.slug === "club")!.id)!;
    expect(club.members.slice(0, 3).map((id) => nameOf(taxonomy, id))).toEqual(["Afro house", "Afrobeats", "Amapiano"]);
  });

  it("ajoute une liste collée à un groupe : crée les nouvelles, range les connues, saute celles déjà là", async () => {
    const result = await editor.addTags({ facetId: await facetId("genre"), groupId: await tagId("club") }, ["Afro house", "Kizomba", "Baile funk", "Funk carioca"]);
    expect(result).toEqual({ ok: true, created: ["Funk carioca"], placed: ["Kizomba"], already: ["Afro house", "Baile funk"] });
    expect(await membersOf("genre", "club")).toEqual(expect.arrayContaining(["Funk carioca", "Kizomba"]));
    // Kizomba garde sa place dans Afrique / Moyen-Orient.
    expect(await membersOf("geographie", "afrique-moyen-orient")).toContain("Kizomba");
    // Un nom tapé autrement retrouve l'étiquette : sans accents ni majuscules.
    expect(await editor.addTags({ facetId: await facetId("genre"), groupId: await tagId("club") }, ["coupe decale"])).toMatchObject({ already: ["Coupé-décalé"] });
    expect(await editor.addTags({ facetId: await facetId("genre"), groupId: await tagId("caraibes") }, ["X"])).toEqual({ ok: false, errors: { form: expect.stringContaining("n'existe plus") } });
  });

  it("ajoute un groupe à la fin d'un filtre", async () => {
    const result = await editor.addTags({ facetId: await facetId("genre"), groupId: null }, ["Musiques de film"]);
    expect(result).toMatchObject({ ok: true, created: ["Musiques de film"] });
    const taxonomy = await editor.taxonomy();
    const genre = taxonomy.facets.find((one) => one.slug === "genre")!;
    expect(nameOf(taxonomy, genre.groups.at(-1)!.tagId)).toBe("Musiques de film");
  });

  it("renomme une étiquette, et refuse une adresse ou un nom déjà pris", async () => {
    const id = await tagId("wassalou");
    expect(await editor.renameTag(id, { name: "Wassalou (Mali)", slug: "wassalou" })).toEqual({ ok: true, id });
    expect(await editor.renameTag(id, { name: "Wassoulou", slug: "wassalou" })).toEqual({ ok: false, errors: { name: expect.stringContaining("fusionne") } });
    expect(await editor.renameTag(id, { name: "Autre nom", slug: "wassoulou" })).toEqual({ ok: false, errors: { slug: expect.stringContaining("« Wassoulou »") } });
    expect(await editor.renameTag("pas-un-id", { name: "X", slug: "x" })).toMatchObject({ ok: false });
  });

  it("range une étiquette à une autre place, puis l'en retire ; retirer un groupe retire ses étiquettes de ce groupe", async () => {
    const genre = await facetId("genre");
    const reggae = await tagId("reggae");
    expect(await editor.placeTag(reggae, { facetId: genre, groupId: null })).toEqual({ ok: true, added: true });
    expect(await editor.placeTag(reggae, { facetId: genre, groupId: null })).toEqual({ ok: true, added: false });
    expect(await editor.addTags({ facetId: genre, groupId: reggae }, ["Dub", "Rocksteady"])).toMatchObject({ placed: ["Dub", "Rocksteady"] });
    expect(await membersOf("genre", "reggae")).toEqual(["Dub", "Rocksteady"]);
    // Retirer le groupe Reggae de Genre : ses étiquettes quittent ce groupe, pas les Caraïbes.
    expect(await editor.unplaceTag(reggae, { facetId: genre, groupId: null })).toBe(true);
    expect(await membersOf("genre", "reggae")).toBeNull();
    expect(await membersOf("geographie", "caraibes")).toEqual(expect.arrayContaining(["Dub", "Reggae", "Rocksteady"]));
    expect(await editor.unplaceTag(reggae, { facetId: genre, groupId: null })).toBe(false);
  });

  it("monte et descend un groupe", async () => {
    const theme = await facetId("theme");
    const order = async () => {
      const taxonomy = await editor.taxonomy();
      return taxonomy.facets.find((one) => one.slug === "theme")!.groups.map((group) => nameOf(taxonomy, group.tagId));
    };
    expect(await editor.moveGroup(theme, await tagId("musique"), "up")).toBe(true);
    expect(await order()).toEqual(["Culture", "Musique", "Société"]);
    expect(await editor.moveGroup(theme, await tagId("culture"), "up")).toBe(true);
    expect(await order()).toEqual(["Culture", "Musique", "Société"]);
    expect(await editor.moveGroup(theme, await tagId("techno"), "down")).toBe(false);
  });

  it("fusionne deux étiquettes : les shows et les places passent à celle qu'on garde", async () => {
    const [carte] = await connection.db.select({ id: show.id }).from(show).where(eq(show.slug, "exemple-carte-blanche"));
    const from = await tagId("amapiano");
    const into = await tagId("gqom");
    expect(await editor.mergeTags(from, into)).toEqual({ ok: true, from: "Amapiano", into: "Gqom" });
    const onShow = await connection.db.select({ tagId: showTag.tagId }).from(showTag).where(eq(showTag.showId, carte!.id));
    expect(onShow.map((row) => row.tagId)).toContain(into);
    expect((await connection.db.select().from(tag).where(eq(tag.id, from))).length).toBe(0);
    expect(await membersOf("genre", "club")).not.toContain("Amapiano");
    expect(await editor.mergeTags(into, into)).toEqual({ ok: false, errors: { into: expect.any(String) } });
    expect(await editor.mergeTags(from, into)).toMatchObject({ ok: false, errors: { form: expect.stringContaining("n'existe plus") } });
  });

  it("fusionne un groupe dans une étiquette, qui devient le groupe", async () => {
    const regions = await facetId("geographie");
    const europe = await tagId("europe");
    const [made] = await connection.db.insert(tag).values({ name: "Europe (doublon)", slug: "europe-doublon" }).returning({ id: tag.id });
    expect(await editor.mergeTags(europe, made!.id)).toMatchObject({ ok: true });
    expect(await membersOf("geographie", "europe-doublon")).toEqual(expect.arrayContaining(["Fado portugais", "Pop des Balkans"]));
    expect(await editor.placeTag(made!.id, { facetId: regions, groupId: null })).toEqual({ ok: true, added: false });
  });

  it("supprime une étiquette, et les étiquettes à classer qui ne servent à rien", async () => {
    expect(await editor.deleteTag(await tagId("library-music"))).toEqual({ name: "Library music" });
    expect(await editor.deleteTag("6f1c1f0e-8c2a-4b8e-9a51-0d1c2b3a4f5e")).toBeNull();
    await connection.db.insert(tag).values([
      { name: "Oubliée", slug: "oubliee" },
      { name: "Oubliée aussi", slug: "oubliee-aussi" },
    ]);
    // Les étiquettes d'exemple sans place servent à des shows : elles restent.
    expect(await editor.deleteUnusedTags()).toBe(2);
    expect(await connection.db.select().from(tag).where(eq(tag.slug, "exemple-quartier"))).toHaveLength(1);
  });

  it("crée, modifie, déplace et supprime un filtre ; ses étiquettes restent", async () => {
    const values = readFacetForm({ name: "Langue", slug: "", scope: "show", showTypes: ["podcast"], description: "La langue du podcast." }).values;
    const created = await editor.saveFacet({ values });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    expect(await editor.saveFacet({ values })).toEqual({ ok: false, errors: { slug: "Cette adresse sert déjà au filtre « Langue »." } });
    await editor.addTags({ facetId: created.id, groupId: null }, ["Wolof", "Créole"]);
    // Ce qu'il range ne change pas après sa création.
    expect(await editor.saveFacet({ id: created.id, values: { ...values, name: "Langues", scope: "event", showTypes: ["podcast", "dj_set"] } })).toEqual({ ok: true, id: created.id });
    let taxonomy = await editor.taxonomy();
    expect(taxonomy.facets.at(-1)).toMatchObject({ name: "Langues", scope: "show", showTypes: ["podcast", "dj_set"] });
    expect(await editor.moveFacet(created.id, "up")).toBe(true);
    taxonomy = await editor.taxonomy();
    expect(taxonomy.facets.map((one) => one.slug).slice(-2)).toEqual(["langue", "categorie"]);
    expect(await editor.deleteFacet(created.id)).toEqual({ name: "Langues" });
    taxonomy = await editor.taxonomy();
    expect(taxonomy.tags.find((one) => one.name === "Wolof")).toBeDefined();
    expect(await editor.deleteFacet(created.id)).toBeNull();
  });

  it("refuse tout à un compte hors de l'équipe", async () => {
    expect(await stranger.addTags({ facetId: await facetId("genre"), groupId: null }, ["Intrus"])).toMatchObject({ ok: false });
    expect(await stranger.renameTag(await tagId("techno"), { name: "Piraté", slug: "techno" })).toMatchObject({ ok: false });
    expect(await stranger.deleteTag(await tagId("techno"))).toBeNull();
    expect(await stranger.deleteFacet(await facetId("genre"))).toBeNull();
    expect((await editor.taxonomy()).tags.find((one) => one.slug === "techno")).toMatchObject({ name: "Techno" });
  });

  it("change aussitôt ce que voit le site", async () => {
    const site = createReader(connection.db, { mediaBaseUrl: MEDIA_BASE });
    await editor.addTags({ facetId: await facetId("genre"), groupId: await tagId("house-techno") }, ["Minimal"]);
    const theme = await facetId("theme");
    await editor.unplaceTag(await tagId("societe"), { facetId: theme, groupId: null });
    const podcasts = await site.listFacets({ scope: "show", type: "podcast" });
    expect(podcasts).toEqual([]);
    const [carte] = await site.listShows({ tags: ["club"] }).then((page) => page.items);
    expect(carte?.slug).toBe("exemple-carte-blanche");
  });
});

describe("le menu « Étiquette » des listes de l'admin", () => {
  let connection: Connection;
  let editor: Admin;
  beforeAll(async () => {
    connection = await exampleDb();
    editor = createAdmin(connection.db, await createAccount(connection.db, "editor"));
  });
  afterAll(() => connection.close());

  it("range ce qui sert comme les filtres du site, brouillons compris, et met à la fin ce qui est à classer", async () => {
    const menu = await editor.tagFilter("show", { used: true });
    expect(menu.map((one) => one.facet)).toEqual(["Thème", "Genre", "Géographie", "À classer"]);
    const genre = menu.find((one) => one.facet === "Genre")!;
    expect(genre.options.map((option) => `${option.group ? "" : "  "}${option.name} ${option.count}`)).toEqual([
      "Jazz 1",
      "Ambient 1",
      "Club 1",
      "  Amapiano 1",
      "House / techno 5",
      "  Deep house 1",
      "  Detroit techno 1",
      "  House 2",
      "  Techno 3",
    ]);
    expect(menu.at(-1)!.options.map((option) => option.name)).toEqual(["Écologie (exemple)", "Quartier (exemple)"]);
  });

  it("montre tout, à la demande : les activités des artistes", async () => {
    const menu = await editor.tagFilter("artist");
    expect(menu).toEqual([
      {
        facet: "Activité",
        options: [
          { id: expect.any(String), name: "Podcast", group: true, count: 2 },
          { id: expect.any(String), name: "Playlist", group: true, count: 2 },
          { id: expect.any(String), name: "DJ", group: true, count: 5 },
        ],
      },
    ]);
  });
});
