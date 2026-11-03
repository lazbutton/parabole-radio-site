/**
 * Le document « Tags et filtres site web » appliqué au classement (src/admin/document.ts) : sa lecture, puis la
 * version du 3 novembre 2026 appliquée sur le classement de la migration 0007 (la version du 2 novembre), avec le jeu
 * d'exemples, sous le rôle d'un éditeur. Le document de test ne garde que les rubriques des étiquettes.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, readTagDocument, type Admin, type DocumentChanges, type NotSaved } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { show, showTag, tag } from "../src/schema.ts";
import { createAccount, exampleDb, MEDIA_BASE, rowsOf } from "./helpers.ts";

const NOVEMBER_3 = readFileSync(new URL("./documents/tags-et-filtres-3-novembre.md", import.meta.url), "utf8");

const done = (result: DocumentChanges | NotSaved): DocumentChanges => {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result;
};

describe("la lecture du document", () => {
  const doc = readTagDocument(NOVEMBER_3);
  const facet = (slug: string) => doc.facets.find((one) => one.slug === slug)!;
  const group = (slug: string, name: string) => facet(slug).groups.find((one) => one.name === name)!;

  it("trouve les cinq filtres, et s'arrête à « À propos »", () => {
    expect(doc.problems).toEqual([]);
    expect(doc.facets.map((one) => [one.slug, one.groups.length])).toEqual([
      ["theme", 3],
      ["genre", 13],
      ["geographie", 5],
      ["activite", 3],
      ["categorie", 5],
    ]);
    expect(JSON.stringify(doc)).not.toContain("Ancienne liste");
  });

  it("lit les groupes en gras et leurs étiquettes, sans recopier celle qui porte le nom du groupe", () => {
    expect(facet("genre").groups.map((one) => one.name)).toEqual([
      "Classique",
      "Pop & variété",
      "Rock",
      "Jazz",
      "Soul & funk",
      "Rap & RnB",
      "Reggae & dub",
      "Ambient & expérimentales",
      "House & electro",
      "Techno",
      "Breaks & bass music",
      "Club",
      "Live & parole",
    ]);
    expect(group("genre", "Rock").members).toEqual(["Country", "Hard rock", "Indie rock", "Métal", "Post-punk", "Psychédélique", "Rock alternatif"]);
    expect(group("genre", "Techno").members).toContain("Techno de Détroit");
    expect(group("genre", "Techno").members).not.toContain("Techno");
    expect(group("genre", "Rap & RnB").members).toEqual(expect.arrayContaining(["Rap UK", "RnB", "Neo-soul", "Rap français"]));
    expect(group("genre", "Ambient & expérimentales").members).toContain("Électronique expérimental");
    expect(group("genre", "Reggae & dub").members).toEqual([]);
  });

  it("garde les thèmes une ligne par étiquette, et les nouvelles régions", () => {
    expect(group("theme", "Culture").members).toEqual(["Architecture", "Art", "Cinéma", "Design", "Food", "Littérature", "Mode", "Photographie"]);
    expect(group("geographie", "Afrique / Moyen-Orient").members).toEqual(expect.arrayContaining(["Kwaito", "Ndombolo", "Wisisi"]));
    expect(group("geographie", "Asie").members).toContain("Vinahouse");
    expect(facet("categorie").groups.map((one) => one.name)).toEqual(["Live session_art ensemble", "Fête", "Rencontre/talk", "DJ set_on air", "Événement spécial"]);
  });

  it("dit ce qu'il ne sait pas lire, sans s'arrêter", () => {
    const odd = readTagDocument(["# **ÉMISSIONS**", "## **PLAYLIST + DJ SETS**", "### → GENRE", "SANS GROUPE, PERDU", "**HOUSE**", "DEEP HOUSE", "# **BOUTIQUE**", "### → T-SHIRTS"].join("\n"));
    expect(odd.facets).toEqual([{ slug: "genre", name: "Genre", scope: "show", showTypes: ["dj_set", "playlist"], groups: [{ name: "House", members: ["Deep house"] }] }]);
    expect(odd.problems).toEqual([expect.stringContaining("sans groupe"), expect.stringContaining("« BOUTIQUE »")]);
    expect(readTagDocument("Rien à voir.").facets).toEqual([]);
  });
});

describe("le document appliqué au classement", () => {
  let connection: Connection;
  let editor: Admin;
  let stranger: Admin;
  const detroit = { id: "", to: "Techno de Détroit" };

  beforeAll(async () => {
    connection = await exampleDb();
    editor = createAdmin(connection.db, await createAccount(connection.db, "editor"));
    stranger = createAdmin(connection.db, await createAccount(connection.db));
    const [row] = await connection.db.select({ id: tag.id }).from(tag).where(eq(tag.slug, "detroit-techno"));
    detroit.id = row!.id;
  });
  afterAll(() => connection.close());

  const tagCount = async () => rowsOf<{ n: number }>(await connection.db.execute(sql`select count(*)::int as n from tag`))[0]!.n;

  it("montre d'abord ce qui changera, sans rien écrire", async () => {
    const before = await tagCount();
    const preview = done(await editor.previewDocument(NOVEMBER_3));
    expect(await tagCount()).toBe(before);
    expect(preview.unchanged).toBe(false);
    expect(preview.described).toMatchObject({ facets: ["Thème", "Genre", "Géographie", "Activité", "Catégorie"], groups: 29 });
    // Seul Genre et deux régions changent ; Thème, Activité et Catégorie restent tels quels.
    expect(preview.facets.map((one) => one.name)).toEqual(["Genre", "Géographie"]);
    const genre = preview.facets[0]!;
    expect(genre.addedGroups).toEqual(["Soul & funk", "Rap & RnB", "Reggae & dub", "Ambient & expérimentales", "House & electro", "Techno", "Breaks & bass music", "Live & parole"]);
    expect(genre.removedGroups).toEqual(
      expect.arrayContaining(["Hip-hop, R'n'B", "Soul", "Disco", "Metal, alternative rock", "Ambient", "Électronique, downtempo", "House / techno", "Talk, poésie, soundtracks"]),
    );
    expect(preview.facets[1]!.groups).toEqual([
      { name: "Afrique / Moyen-Orient", added: ["Kwaito", "Ndombolo", "Wisisi"], removed: [] },
      { name: "Asie", added: ["Vinahouse"], removed: [] },
    ]);
    // « Detroit techno » sert à un show : gardée, à classer, avec le nom qui lui ressemble.
    expect(preview.kept).toEqual([{ id: detroit.id, name: "Detroit techno", shows: 1, artists: 0, events: 0, suggestion: "Techno de Détroit" }]);
    expect(preview.deleted).toEqual(expect.arrayContaining(["Gabber", "Makina", "Nightcore", "UK funky", "House / techno"]));
    expect(preview.deleted).not.toContain("Kwaito");
    expect(preview.renamed).toEqual(expect.arrayContaining([{ from: "Pop, variété", to: "Pop & variété" }, { from: "Post punk", to: "Post-punk" }]));
  });

  it("applique le document : un renommage garde les shows, l'ordre suit le document", async () => {
    const result = done(await editor.importDocument(NOVEMBER_3, [detroit]));
    expect(result.kept).toEqual([]);
    expect(result.renamed).toEqual(expect.arrayContaining([{ from: "Detroit techno", to: "Techno de Détroit" }]));
    const [minuit] = await connection.db.select({ id: show.id }).from(show).where(eq(show.slug, "exemple-techno-de-minuit"));
    const onShow = await connection.db.select({ slug: tag.slug }).from(showTag).innerJoin(tag, eq(tag.id, showTag.tagId)).where(eq(showTag.showId, minuit!.id));
    expect(onShow.map((row) => row.slug).sort()).toEqual(["techno", "techno-de-detroit"]);
    const taxonomy = await editor.taxonomy();
    const genre = taxonomy.facets.find((one) => one.slug === "genre")!;
    const name = (id: string) => taxonomy.tags.find((one) => one.id === id)?.name;
    expect(genre.groups.map((group) => name(group.tagId))).toEqual([
      "Classique",
      "Pop & variété",
      "Rock",
      "Jazz",
      "Soul & funk",
      "Rap & RnB",
      "Reggae & dub",
      "Ambient & expérimentales",
      "House & electro",
      "Techno",
      "Breaks & bass music",
      "Club",
      "Live & parole",
    ]);
    // Amapiano reste à ses deux places ; Kwaito n'est plus que dans Afrique.
    const club = genre.groups.find((group) => name(group.tagId) === "Club")!;
    expect(club.members.map(name)).toContain("Amapiano");
    expect(club.members.map(name)).not.toContain("Kwaito");
    expect(taxonomy.tags.find((one) => one.name === "Gabber")).toBeUndefined();
    expect(taxonomy.tags.find((one) => one.name === "Kwaito")).toBeDefined();
  });

  it("ne change plus rien une fois appliqué", async () => {
    const again = done(await editor.importDocument(NOVEMBER_3));
    expect(again.unchanged).toBe(true);
  });

  it("met le site à jour : le filtre Techno trouve le show de Détroit", async () => {
    const site = createReader(connection.db, { mediaBaseUrl: MEDIA_BASE });
    expect((await site.listShows({ tags: ["techno-de-detroit"] })).items.map((one) => one.slug)).toEqual(["exemple-techno-de-minuit"]);
    const menus = await site.listFacets({ scope: "show", type: "dj_set" });
    const techno = menus.find((one) => one.slug === "genre")!.groups.find((group) => group.slug === "techno")!;
    expect(techno.tags.map((one) => one.slug)).toEqual(["techno-de-detroit"]);
  });

  it("refuse un texte qui n'est pas le document, et tout à un compte hors de l'équipe", async () => {
    expect(await editor.previewDocument("Une liste de courses.")).toEqual({ ok: false, errors: { document: expect.stringContaining("ne ressemble pas") } });
    const baroque = NOVEMBER_3.replace("**CLASSIQUE**", "**BAROQUE**");
    expect(await stranger.previewDocument(baroque)).toMatchObject({ ok: false, errors: { form: expect.any(String) } });
    expect(await stranger.importDocument(baroque)).toMatchObject({ ok: false, errors: { form: expect.any(String) } });
  });
});
