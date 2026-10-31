import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "../src/db.ts";
import { indexLetter } from "../src/read/artists.ts";
import { paging, startOfParisDay, toImage } from "../src/read/common.ts";
import { createReader, type Reader } from "../src/read/index.ts";
import { slugify } from "../src/slug.ts";
import { exampleDb, MEDIA_BASE, NOW } from "./helpers.ts";

let connection: Connection;
let cms: Reader;

beforeAll(async () => {
  connection = await exampleDb();
  cms = createReader(connection.db, { mediaBaseUrl: `${MEDIA_BASE}/` });
});
afterAll(() => connection.close());

const slugs = (items: { slug: string }[]) => items.map((item) => item.slug);

describe("liste des shows", () => {
  it("ne montre que le publié, du plus récent au plus ancien", async () => {
    const { items, total } = await cms.listShows({ now: NOW });
    expect(total).toBe(8);
    expect(slugs(items)).not.toContain("exemple-set-non-publie");
    const dates = items.map((item) => item.broadcastAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("filtre par type", async () => {
    expect(slugs((await cms.listShows({ type: "podcast" })).items)).toEqual(["exemple-voix-de-la-goutte-d-or", "exemple-ecologie-au-quotidien"]);
    expect(slugs((await cms.listShows({ type: "playlist" })).items)).toEqual(["exemple-matin-calme", "exemple-jazz-du-marche-dejean"]);
  });

  it("filtre par genre, mood et thème, sans confondre un genre et un mood du même nom", async () => {
    expect(slugs((await cms.listShows({ genre: "exemple-house" })).items)).toEqual(["exemple-session-a-venir", "exemple-dimanche-house-a-la-chapelle"]);
    expect(slugs((await cms.listShows({ genre: "exemple-ambient" })).items)).toEqual(["exemple-matin-calme"]);
    expect(slugs((await cms.listShows({ mood: "exemple-ambient" })).items)).toEqual(["exemple-jazz-du-marche-dejean"]);
    expect(slugs((await cms.listShows({ theme: "exemple-quartier" })).items)).toEqual(["exemple-voix-de-la-goutte-d-or"]);
  });

  it("filtre par artiste, sans montrer les shows en brouillon de cet artiste", async () => {
    expect(slugs((await cms.listShows({ artist: "exemple-yaya-kossi" })).items)).toEqual(["exemple-carte-blanche", "exemple-techno-de-minuit"]);
    // Ana Brouillon n'est pas publiée : son nom ne filtre rien.
    expect((await cms.listShows({ artist: "exemple-ana-brouillon" })).total).toBe(0);
  });

  it("combine les filtres", async () => {
    const { items } = await cms.listShows({ type: "dj_set", mood: "exemple-dansant", genre: "exemple-techno" });
    expect(slugs(items)).toEqual(["exemple-techno-de-minuit"]);
    expect((await cms.listShows({ type: "podcast", genre: "exemple-techno" })).total).toBe(0);
  });

  it("sépare les archives des shows à venir", async () => {
    const past = await cms.listShows({ period: "past", now: NOW });
    expect(past.total).toBe(7);
    expect(slugs(past.items)).not.toContain("exemple-session-a-venir");
    const upcoming = await cms.listShows({ period: "upcoming", now: NOW });
    expect(slugs(upcoming.items)).toEqual(["exemple-session-a-venir"]);
  });

  it("pagine, avec le total", async () => {
    const first = await cms.listShows({ period: "past", now: NOW, limit: 3 });
    const second = await cms.listShows({ period: "past", now: NOW, limit: 3, offset: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.total).toBe(7);
    expect(second.items).toHaveLength(3);
    expect(new Set([...slugs(first.items), ...slugs(second.items)]).size).toBe(6);
    expect(second.offset).toBe(3);
  });

  it("donne une vignette complète : artistes publiés dans l'ordre, étiquettes, pochette", async () => {
    const { items } = await cms.listShows({ now: NOW });
    const techno = items.find((item) => item.slug === "exemple-techno-de-minuit")!;
    expect(techno.artists.map((artist) => artist.name)).toEqual(["Bastien Ocre (exemple)", "Yaya Kossi (exemple)"]);
    expect(techno.tags.map((tag) => `${tag.kind}:${tag.slug}`)).toEqual(["genre:exemple-musiques-electroniques", "genre:exemple-techno", "mood:exemple-dansant"]);
    expect(techno.cover?.url).toBe(`${MEDIA_BASE}/exemples/pochette-techno-de-minuit.webp`);
    // L'invitée en brouillon n'apparaît pas sur un show publié.
    const carte = items.find((item) => item.slug === "exemple-carte-blanche")!;
    expect(carte.artists.map((artist) => artist.slug)).toEqual(["exemple-yaya-kossi"]);
  });

  it("rend une liste vide pour un filtre inconnu ou mal formé, sans erreur", async () => {
    expect((await cms.listShows({ type: "concert" as never })).total).toBe(0);
    expect((await cms.listShows({ genre: "House; drop table show" })).total).toBe(0);
    expect((await cms.listShows({ genre: "exemple-inconnu" })).total).toBe(0);
    expect(await cms.listShows({ limit: Number.NaN, offset: -4 })).toMatchObject({ limit: 24, offset: 0 });
  });
});

describe("page d'un show", () => {
  it("donne la tracklist dans l'ordre, les artistes, les étiquettes et la piste SoundCloud", async () => {
    const show = await cms.getShow("exemple-dimanche-house-a-la-chapelle");
    expect(show).not.toBeNull();
    expect(show!.title).toBe("Dimanche house à la Chapelle (exemple)");
    expect(show!.type).toBe("dj_set");
    expect(show!.durationSeconds).toBe(7200);
    expect(show!.soundcloudTrackId).toBe("1000000001");
    expect(show!.soundcloudUrl).toMatch(/^https:\/\/soundcloud\.com\//);
    expect(show!.artists.map((artist) => artist.slug)).toEqual(["exemple-eloise-vachon"]);
    expect(show!.tracks.map((track) => track.position)).toEqual([1, 2, 3, 4, 5]);
    expect(show!.tracks[0]).toEqual({ position: 1, artist: "Orchestre Imaginaire", title: "Lumière de Barbès", startSeconds: 0, hopperUrl: "https://hppr.fr/exemple-lumiere-de-barbes" });
    expect(show!.tracks[4]).toMatchObject({ title: "Dernier métro", startSeconds: 6750, hopperUrl: null });
  });

  it("donne l'image avec ses versions réduites pour srcset", async () => {
    const show = await cms.getShow("exemple-dimanche-house-a-la-chapelle");
    expect(show!.cover).toEqual({
      url: `${MEDIA_BASE}/exemples/pochette-dimanche-house.webp`,
      width: 1200,
      height: 1200,
      alt: "Platines sous une lumière orange (image d'exemple)",
      credit: null,
      srcset: `${MEDIA_BASE}/exemples/pochette-dimanche-house-400.webp 400w, ${MEDIA_BASE}/exemples/pochette-dimanche-house-800.webp 800w, ${MEDIA_BASE}/exemples/pochette-dimanche-house.webp 1200w`,
    });
  });

  it("n'existe pas pour un brouillon, un inconnu ou une adresse mal formée", async () => {
    expect(await cms.getShow("exemple-set-non-publie")).toBeNull();
    expect(await cms.getShow("exemple-inconnu")).toBeNull();
    expect(await cms.getShow("../etc/passwd")).toBeNull();
  });
});

describe("étiquettes", () => {
  it("compte les shows publiés de chaque étiquette, par type d'étiquette puis par nom", async () => {
    const tags = await cms.listTags();
    expect(tags.map((tag) => tag.kind)).toEqual([...tags.map((tag) => tag.kind)].sort());
    expect(tags.find((tag) => tag.kind === "genre" && tag.slug === "exemple-techno")?.shows).toBe(2);
    // Mélancolique entre Dansant et… : l'ordre est alphabétique français.
    expect(tags.filter((tag) => tag.kind === "mood").map((tag) => tag.name)).toEqual(["Ambient (exemple)", "Calme (exemple)", "Dansant (exemple)", "Mélancolique (exemple)"]);
  });

  it("filtre par type d'étiquette et par type de show", async () => {
    expect((await cms.listTags({ kind: "theme" })).map((tag) => tag.slug)).toEqual(["exemple-ecologie", "exemple-quartier"]);
    const playlists = await cms.listTags({ type: "playlist" });
    expect(playlists.map((tag) => tag.slug)).not.toContain("exemple-techno");
    expect(playlists.find((tag) => tag.slug === "exemple-jazz")?.shows).toBe(1);
  });
});

describe("artistes", () => {
  it("range les artistes publiés par lettre, à la française, # à la fin", async () => {
    const { total, groups } = await cms.listArtists();
    expect(total).toBe(7);
    expect(groups.map((group) => group.letter)).toEqual(["B", "C", "E", "Y", "Z", "#"]);
    expect(groups.find((group) => group.letter === "E")!.artists.map((artist) => artist.name)).toEqual(["Elle & Lui (exemple)", "Éloïse Vachon (exemple)"]);
    expect(groups.at(-1)!.artists.map((artist) => artist.slug)).toEqual(["exemple-404-crew"]);
  });

  it("sépare résidents et invités, sans les brouillons", async () => {
    const residents = await cms.listArtists({ role: "resident" });
    expect(residents.total).toBe(3);
    expect(residents.groups.flatMap((group) => group.artists).every((artist) => artist.role === "resident")).toBe(true);
    const guests = await cms.listArtists({ role: "guest" });
    expect(guests.groups.flatMap((group) => group.artists).map((artist) => artist.slug)).not.toContain("exemple-ana-brouillon");
    expect((await cms.listArtists({ role: "dj" as never })).total).toBe(0);
  });

  it("donne la page d'un artiste avec ses shows, ses événements et les étiquettes de ses shows", async () => {
    const artist = await cms.getArtist("exemple-eloise-vachon");
    expect(artist).not.toBeNull();
    expect(artist!.role).toBe("resident");
    expect(artist!.photo?.credit).toBe("© Photographe exemple");
    expect(artist!.links).toHaveLength(2);
    expect(slugs(artist!.shows)).toEqual(["exemple-dimanche-house-a-la-chapelle", "exemple-ecologie-au-quotidien"]);
    // Son événement en brouillon n'apparaît pas.
    expect(slugs(artist!.events)).toEqual(["exemple-nuit-parabole", "exemple-talk-ecologie-sonore"]);
    expect(artist!.tags.map((tag) => tag.slug)).toEqual(expect.arrayContaining(["exemple-house", "exemple-ecologie", "exemple-dansant"]));
  });

  it("n'a pas de page pour un artiste en brouillon", async () => {
    expect(await cms.getArtist("exemple-ana-brouillon")).toBeNull();
  });

  it("met chaque nom sous sa lettre", () => {
    expect(indexLetter("Éloïse")).toBe("E");
    expect(indexLetter("« Zélie »")).toBe("Z");
    expect(indexLetter("œil")).toBe("O");
    expect(indexLetter("404 Crew")).toBe("#");
    expect(indexLetter("")).toBe("#");
  });
});

describe("événements", () => {
  it("donne les événements à venir, du plus proche au plus lointain", async () => {
    const { items, total } = await cms.listEvents({ period: "upcoming", now: NOW });
    expect(total).toBe(3);
    expect(slugs(items)).toEqual(["exemple-atelier-du-jour", "exemple-nuit-parabole", "exemple-rencontre-radios-de-quartier"]);
  });

  it("donne les événements passés, du plus récent au plus ancien, sans les brouillons", async () => {
    const { items } = await cms.listEvents({ period: "past", now: NOW });
    expect(slugs(items)).toEqual(["exemple-talk-ecologie-sonore", "exemple-expo-sonore", "exemple-soiree-speciale-anniversaire"]);
  });

  it("filtre par catégorie", async () => {
    expect(slugs((await cms.listEvents({ period: "past", category: "talk", now: NOW })).items)).toEqual(["exemple-talk-ecologie-sonore"]);
    expect(slugs((await cms.listEvents({ period: "upcoming", category: "talk", now: NOW })).items)).toEqual(["exemple-rencontre-radios-de-quartier"]);
    expect((await cms.listEvents({ period: "past", category: "special", now: NOW })).total).toBe(1);
    expect((await cms.listEvents({ period: "upcoming", category: "concert" as never, now: NOW })).total).toBe(0);
  });

  it("garde un événement sans heure de fin « à venir » jusqu'à minuit, heure de Paris", async () => {
    const atelier = (await cms.listEvents({ period: "upcoming", now: NOW })).items[0]!;
    expect(atelier.slug).toBe("exemple-atelier-du-jour");
    expect(atelier.startsAt.getTime()).toBeLessThan(NOW.getTime());
    // Le lendemain à 0 h 30 (heure de Paris), il est passé.
    const tomorrow = new Date("2026-06-13T22:30:00Z");
    expect(slugs((await cms.listEvents({ period: "past", now: tomorrow })).items)).toContain("exemple-atelier-du-jour");
  });

  it("donne la page d'un événement avec sa galerie dans l'ordre et ses légendes", async () => {
    const expo = await cms.getEvent("exemple-expo-sonore");
    expect(expo).not.toBeNull();
    expect(expo!.category).toBe("art_ensemble");
    expect(expo!.photos.map((photo) => [photo.url.split("/").at(-1), photo.caption])).toEqual([
      ["galerie-expo-2.webp", "Le coin d'écoute"],
      ["galerie-expo-1.webp", "Le vernissage"],
      ["galerie-expo-3.webp", null],
    ]);
    expect(expo!.artists.map((artist) => artist.slug)).toEqual(["exemple-zelie-marteau"]);
    const fete = await cms.getEvent("exemple-soiree-speciale-anniversaire");
    expect(fete!.artists.map((artist) => artist.slug)).toEqual(["exemple-bastien-ocre", "exemple-yaya-kossi"]);
    const nuit = await cms.getEvent("exemple-nuit-parabole");
    expect(nuit).toMatchObject({ ticketUrl: "https://example.com/billetterie/nuit-parabole", address: "1 rue de l'Exemple, 75018 Paris" });
  });

  it("n'a pas de page pour un événement en brouillon", async () => {
    expect(await cms.getEvent("exemple-evenement-brouillon")).toBeNull();
  });
});

describe("pages", () => {
  it("donne une page publiée, en Markdown", async () => {
    const page = await cms.getPage("exemple-a-propos");
    expect(page).toMatchObject({ slug: "exemple-a-propos", title: "À propos (exemple)" });
    expect(page!.body).toContain("**Texte d'exemple.**");
  });

  it("ne donne ni brouillon ni page inconnue", async () => {
    expect(await cms.getPage("exemple-page-brouillon")).toBeNull();
    expect(await cms.getPage("a-propos")).toBeNull();
  });
});

describe("outils", () => {
  it("fabrique des slugs", () => {
    expect(slugify("Nuit Parabole #3 : Éloïse & Zélie")).toBe("nuit-parabole-3-eloise-zelie");
    expect(slugify("  Cœur d'œuvre  ")).toBe("coeur-d-oeuvre");
    expect(slugify("!!!")).toBe("");
  });

  it("borne la pagination", () => {
    expect(paging({ limit: 1000, offset: 2.7 })).toEqual({ limit: 100, offset: 2 });
    expect(paging({ limit: 0 })).toEqual({ limit: 1, offset: 0 });
  });

  it("trouve minuit à Paris, l'été comme l'hiver", () => {
    expect(startOfParisDay(new Date("2026-06-13T10:00:00Z")).toISOString()).toBe("2026-06-12T22:00:00.000Z");
    expect(startOfParisDay(new Date("2026-12-01T23:30:00Z")).toISOString()).toBe("2026-12-01T23:00:00.000Z");
    // Jour du passage à l'heure d'hiver (25 octobre 2026) : minuit est encore à l'heure d'été.
    expect(startOfParisDay(new Date("2026-10-25T20:00:00Z")).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("fait des adresses d'images propres", () => {
    const image = toImage("https://media.example.test///", { key: "a b/é.webp", width: null, height: null, alt: "", credit: null, variants: [] });
    expect(image?.url).toBe("https://media.example.test/a%20b/%C3%A9.webp");
    expect(image?.srcset).toBeNull();
  });
});
