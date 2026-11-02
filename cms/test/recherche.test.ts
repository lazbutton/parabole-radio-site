import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "../src/db.ts";
import { createReader, type Reader } from "../src/read/index.ts";
import { prefixQuery } from "../src/read/search.ts";
import { exampleDb, MEDIA_BASE } from "./helpers.ts";

let connection: Connection;
let cms: Reader;

beforeAll(async () => {
  connection = await exampleDb();
  cms = createReader(connection.db, { mediaBaseUrl: MEDIA_BASE });
});
afterAll(() => connection.close());

const found = async (query: string) => {
  const results = await cms.search(query);
  return { shows: results.shows.map((show) => show.slug), artists: results.artists.map((artist) => artist.slug), events: results.events.map((event) => event.slug) };
};

describe("recherche en français", () => {
  it("ramène les mots à leur racine : le singulier trouve le pluriel", async () => {
    // « musiques électroniques » dans une description, « Diasporas » dans le nom d'une étiquette.
    expect((await found("musique électronique")).shows).toEqual(["exemple-dimanche-house-a-la-chapelle"]);
    expect((await found("diaspora")).shows).toEqual(["exemple-voix-de-la-goutte-d-or"]);
  });

  it("ignore les accents et les majuscules", async () => {
    expect((await found("eloise")).artists).toEqual(["exemple-eloise-vachon"]);
    expect((await found("ÉLOÏSE")).artists).toEqual(["exemple-eloise-vachon"]);
    expect((await found("ecologie au quotidien")).shows[0]).toBe("exemple-ecologie-au-quotidien");
    expect((await found("zelie")).artists).toEqual(["exemple-zelie-marteau"]);
  });

  it("trouve un début de mot, comme pendant la frappe", async () => {
    expect((await found("jaz")).shows).toEqual(["exemple-jazz-du-marche-dejean"]);
    expect((await found("Éloïse V")).artists).toEqual(["exemple-eloise-vachon"]);
    expect((await found("techn")).shows).toEqual(expect.arrayContaining(["exemple-techno-de-minuit", "exemple-carte-blanche"]));
  });

  it("trouve un artiste, ses shows et ses événements par son nom, pas par sa bio", async () => {
    const { shows, artists, events } = await found("Bastien Ocre");
    expect(artists).toEqual(["exemple-bastien-ocre"]);
    expect(shows).toEqual(["exemple-techno-de-minuit"]);
    expect(events).toEqual(["exemple-nuit-parabole", "exemple-soiree-speciale-anniversaire"]);
    // La bio de Zélie parle de jazz : elle sort comme artiste, mais ses shows ne deviennent pas des shows de jazz.
    const jazz = await found("jazz");
    expect(jazz.artists).toEqual(["exemple-zelie-marteau"]);
    expect(jazz.shows).toEqual(["exemple-jazz-du-marche-dejean"]);
  });

  it("trouve un show par sa tracklist et par ses étiquettes", async () => {
    expect((await found("Orchestre Imaginaire")).shows).toEqual(["exemple-dimanche-house-a-la-chapelle"]);
    expect((await found("tunnel")).shows).toEqual(["exemple-techno-de-minuit"]);
    expect((await found("detroit")).shows).toEqual(["exemple-techno-de-minuit"]);
    expect((await found("militantisme")).shows).toEqual(["exemple-ecologie-au-quotidien"]);
  });

  it("trouve un événement par son lieu", async () => {
    expect((await found("galerie imaginaire")).events).toEqual(["exemple-expo-sonore"]);
    expect((await found("bibliotheque")).events).toEqual(["exemple-rencontre-radios-de-quartier", "exemple-talk-ecologie-sonore"]);
  });

  it("met devant ce dont le titre commence par la recherche", async () => {
    const { shows } = await found("quartier");
    // « Voix de la Goutte d'Or » a l'étiquette Quartier ; le jazz du marché, un artiste du quartier dans sa bio : rien.
    expect(shows[0]).toBe("exemple-voix-de-la-goutte-d-or");
    expect((await found("techno")).shows[0]).toBe("exemple-techno-de-minuit");
  });

  it("trouve les noms faits de mots vides", async () => {
    expect((await found("Elle & Lui")).artists).toEqual(["exemple-elle-et-lui"]);
    expect((await found("lui")).artists).toEqual(["exemple-elle-et-lui"]);
  });

  it("ne montre jamais un brouillon, ni par son titre, ni par sa tracklist, ni par ses artistes", async () => {
    expect(await found("set non publié")).toEqual({ shows: [], artists: [], events: [] });
    expect(await found("Morceau confidentiel")).toEqual({ shows: [], artists: [], events: [] });
    expect(await found("Ana Brouillon")).toEqual({ shows: [], artists: [], events: [] });
    expect(await found("événement en brouillon")).toEqual({ shows: [], artists: [], events: [] });
  });

  it("résiste à toutes les saisies", async () => {
    for (const query of ["", "   ", "'", "''", ":*", "a & b | !c :*", "%", "_", "\\", "le la les", "!(", "x".repeat(5000), "🎧 house"]) {
      const results = await cms.search(query);
      expect(results.shows.length + results.artists.length + results.events.length, query.slice(0, 20)).toBeLessThanOrEqual(30);
    }
    expect(await found("%")).toEqual({ shows: [], artists: [], events: [] });
    expect((await found("🎧 house")).shows).toEqual(expect.arrayContaining(["exemple-dimanche-house-a-la-chapelle"]));
  });

  it("limite le nombre de résultats par type", async () => {
    const results = await cms.search("exemple", { limit: 2 });
    expect(results.shows).toHaveLength(2);
    expect(results.artists).toHaveLength(2);
    expect(results.events).toHaveLength(2);
  });

  it("rend des vignettes complètes", async () => {
    const results = await cms.search("dimanche house");
    expect(results.query).toBe("dimanche house");
    expect(results.shows[0]).toMatchObject({ slug: "exemple-dimanche-house-a-la-chapelle", type: "dj_set", cover: { url: `${MEDIA_BASE}/exemples/pochette-dimanche-house.webp` } });
    expect(results.shows[0]!.artists.map((artist) => artist.slug)).toEqual(["exemple-eloise-vachon"]);
  });
});

describe("requête plein texte", () => {
  it("fait de chaque mot un début de mot, sans laisser passer de syntaxe", () => {
    expect(prefixQuery("Éloïse Vachon")).toBe("Éloïse:* & Vachon:*");
    expect(prefixQuery("a & b | !c :*")).toBe("a & b & c:*");
    expect(prefixQuery("l'été")).toBe("l & été:*");
    expect(prefixQuery("Ocre", "A")).toBe("Ocre:*A");
    expect(prefixQuery("')(!:*")).toBeNull();
  });
});
