import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeDatabaseUrl, type Connection } from "../src/db.ts";
import { indexLetter } from "../src/read/artists.ts";
import { paging, startOfParisDay, toImage } from "../src/read/common.ts";
import { createReader, type Reader } from "../src/read/index.ts";
import { slugify } from "../src/slug.ts";
import { seedExamples } from "../seed/exemples.ts";
import { exampleDb, freshDb, MEDIA_BASE, NOW } from "./helpers.ts";

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

  it("filtre par étiquette ; une étiquette de groupe vaut pour tout son groupe", async () => {
    expect(slugs((await cms.listShows({ tags: ["house"] })).items)).toEqual(["exemple-session-a-venir", "exemple-dimanche-house-a-la-chapelle"]);
    expect(slugs((await cms.listShows({ tags: ["ambient"] })).items)).toEqual(["exemple-matin-calme"]);
    expect(slugs((await cms.listShows({ tags: ["exemple-quartier"] })).items)).toEqual(["exemple-voix-de-la-goutte-d-or"]);
    // House / techno : les shows House, Deep house, Techno et Detroit techno.
    expect(slugs((await cms.listShows({ tags: ["house-techno"] })).items)).toEqual([
      "exemple-session-a-venir",
      "exemple-carte-blanche",
      "exemple-dimanche-house-a-la-chapelle",
      "exemple-techno-de-minuit",
    ]);
    expect(slugs((await cms.listShows({ tags: ["societe"] })).items)).toEqual(["exemple-voix-de-la-goutte-d-or", "exemple-ecologie-au-quotidien"]);
  });

  it("trouve une étiquette à chacune de ses places : Amapiano est dans Club et dans Afrique / Moyen-Orient", async () => {
    expect(slugs((await cms.listShows({ tags: ["club"] })).items)).toEqual(["exemple-carte-blanche"]);
    expect(slugs((await cms.listShows({ tags: ["afrique-moyen-orient"] })).items)).toEqual(["exemple-carte-blanche"]);
    expect((await cms.listShows({ tags: ["caraibes"] })).total).toBe(0);
  });

  it("filtre par mood, de calme à énergique", async () => {
    expect(slugs((await cms.listShows({ energy: { min: 4 } })).items)).toEqual(["exemple-carte-blanche", "exemple-dimanche-house-a-la-chapelle", "exemple-techno-de-minuit"]);
    expect(slugs((await cms.listShows({ energy: { max: 2 } })).items)).toEqual(["exemple-matin-calme", "exemple-jazz-du-marche-dejean"]);
    // Toute l'échelle : aucun filtre, les shows sans mood compris.
    expect((await cms.listShows({ energy: { min: 1, max: 5 } })).total).toBe(8);
    expect((await cms.listShows({ energy: { min: 4, max: 2 } })).total).toBe(0);
    expect((await cms.listShows({ energy: { min: 2.5 } })).total).toBe(0);
  });

  it("filtre par artiste, sans montrer les shows en brouillon de cet artiste", async () => {
    expect(slugs((await cms.listShows({ artist: "exemple-yaya-kossi" })).items)).toEqual(["exemple-carte-blanche", "exemple-techno-de-minuit"]);
    // Ana Brouillon n'est pas publiée : son nom ne filtre rien.
    expect((await cms.listShows({ artist: "exemple-ana-brouillon" })).total).toBe(0);
  });

  it("combine les filtres", async () => {
    const { items } = await cms.listShows({ type: "dj_set", tags: ["house-techno", "club"] });
    expect(slugs(items)).toEqual(["exemple-carte-blanche"]);
    expect(slugs((await cms.listShows({ type: "dj_set", tags: ["techno"], energy: { min: 5 } })).items)).toEqual(["exemple-techno-de-minuit"]);
    expect((await cms.listShows({ type: "podcast", tags: ["techno"] })).total).toBe(0);
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
    expect(techno.tags).toEqual([
      { slug: "detroit-techno", name: "Detroit techno" },
      { slug: "techno", name: "Techno" },
    ]);
    expect(techno.energy).toBe(5);
    expect(techno.cover?.url).toBe(`${MEDIA_BASE}/exemples/pochette-techno-de-minuit.webp`);
    // L'invitée en brouillon n'apparaît pas sur un show publié.
    const carte = items.find((item) => item.slug === "exemple-carte-blanche")!;
    expect(carte.artists.map((artist) => artist.slug)).toEqual(["exemple-yaya-kossi"]);
  });

  it("rend une liste vide pour un filtre inconnu ou mal formé, sans erreur", async () => {
    expect((await cms.listShows({ type: "concert" as never })).total).toBe(0);
    expect((await cms.listShows({ tags: ["House; drop table show"] })).total).toBe(0);
    expect((await cms.listShows({ tags: ["exemple-inconnu"] })).total).toBe(0);
    expect(await cms.listShows({ limit: Number.NaN, offset: -4 })).toMatchObject({ limit: 24, offset: 0 });
  });
});

describe("mois des shows", () => {
  it("compte les shows de chaque mois, du plus récent au plus ancien, avec les filtres de la liste", async () => {
    expect(await cms.listShowMonths({ period: "past", now: NOW })).toEqual([
      { month: "2026-06", count: 4 },
      { month: "2026-05", count: 3 },
    ]);
    expect(await cms.listShowMonths({ type: "podcast", period: "past", now: NOW })).toEqual([{ month: "2026-05", count: 2 }]);
    expect(await cms.listShowMonths({ tags: ["house-techno"], energy: { min: 5 }, period: "past", now: NOW })).toEqual([{ month: "2026-06", count: 1 }]);
    expect(await cms.listShowMonths({ period: "upcoming", now: NOW })).toEqual([{ month: "2026-06", count: 1 }]);
  });

  it("rend une liste vide pour un filtre inconnu ou mal formé", async () => {
    expect(await cms.listShowMonths({ type: "concert" as never })).toEqual([]);
    expect(await cms.listShowMonths({ tags: ["House; drop table show"] })).toEqual([]);
    expect(await cms.listShowMonths({ artist: "exemple-inconnu" })).toEqual([]);
  });

  it("range un show dans le mois de Paris : le 1er juin à 0 h 30 est en juin, même s'il est encore le 31 mai en heure universelle", async () => {
    // Le jeu d'exemples daté du 3 juin à 0 h 30 à Paris : Carte blanche, deux jours avant, tombe le 1er juin à 0 h 30.
    const paris = await freshDb();
    try {
      const now = new Date("2026-06-02T22:30:00Z");
      await seedExamples(paris.db, { now });
      const reader = createReader(paris.db, { mediaBaseUrl: MEDIA_BASE });
      expect(await reader.listShowMonths({ period: "past", now })).toEqual([
        { month: "2026-06", count: 1 },
        { month: "2026-05", count: 6 },
      ]);
      expect((await reader.listShows({ period: "past", now, limit: 1 })).items[0]!.slug).toBe("exemple-carte-blanche");
    } finally {
      await paris.close();
    }
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
    // ses réseaux, pour la page de l'émission
    expect(show!.artists[0]!.links).toEqual([
      { label: "Instagram", url: "https://example.com/instagram/eloise-vachon" },
      { label: "SoundCloud", url: "https://example.com/soundcloud/eloise-vachon" },
    ]);
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

describe("filtres", () => {
  it("donne les filtres d'un type de show, groupes dans l'ordre, étiquettes dans l'ordre alphabétique, avec leurs shows publiés", async () => {
    const menus = await cms.listFacets({ scope: "show", type: "dj_set" });
    expect(menus.map((menu) => menu.slug)).toEqual(["genre", "geographie"]);
    const genre = menus[0]!;
    expect(genre.groups.map((group) => [group.slug, group.count])).toEqual([
      ["club", 1],
      ["house-techno", 4],
    ]);
    expect(genre.groups[1]!.tags).toEqual([
      { slug: "deep-house", name: "Deep house", count: 1 },
      { slug: "detroit-techno", name: "Detroit techno", count: 1 },
      { slug: "house", name: "House", count: 2 },
      { slug: "techno", name: "Techno", count: 2 },
    ]);
    expect(menus[1]!.groups).toEqual([{ slug: "afrique-moyen-orient", name: "Afrique / Moyen-Orient", count: 1, tags: [{ slug: "amapiano", name: "Amapiano", count: 1 }] }]);
  });

  it("garde à chaque page ses filtres : les thèmes aux podcasts, l'activité aux artistes, la catégorie aux événements", async () => {
    const podcasts = await cms.listFacets({ scope: "show", type: "podcast" });
    expect(podcasts.map((menu) => [menu.slug, menu.groups.map((group) => `${group.slug} ${group.count}`)])).toEqual([["theme", ["societe 2"]]]);
    const playlists = await cms.listFacets({ scope: "show", type: "playlist" });
    expect(playlists.flatMap((menu) => menu.groups.map((group) => group.slug))).toEqual(["jazz", "ambient"]);
    const artists = await cms.listFacets({ scope: "artist" });
    expect(artists.map((menu) => [menu.slug, menu.groups.map((group) => `${group.slug} ${group.count}`)])).toEqual([["activite", ["podcast 2", "playlist 2", "dj 4"]]]);
    const events = await cms.listFacets({ scope: "event" });
    expect(events[0]!.groups.map((group) => `${group.slug} ${group.count}`)).toEqual(["live-session-art-ensemble 2", "fete 2", "rencontre-talk 2", "evenement-special 1"]);
  });

  it("montre tout, étiquettes sans show comprises, à la demande", async () => {
    const all = await cms.listFacets({ scope: "show", all: true });
    expect(all.map((menu) => [menu.slug, menu.groups.length])).toEqual([
      ["theme", 3],
      ["genre", 14],
      ["geographie", 5],
    ]);
    // les types que range chaque filtre : une page qui montre tous les types en déduit les siens
    expect(all.map((menu) => [menu.slug, menu.showTypes])).toEqual([
      ["theme", ["podcast"]],
      ["genre", ["dj_set", "playlist"]],
      ["geographie", ["dj_set", "playlist"]],
    ]);
    expect(all[2]!.groups.find((group) => group.slug === "caraibes")!.tags).toHaveLength(27);
  });

  it("rend une liste vide pour une page inconnue", async () => {
    expect(await cms.listFacets({ scope: "show", type: "concert" as never })).toEqual([]);
    expect(await cms.listFacets({ scope: "artist", type: "dj_set" })).toEqual([]);
    expect(await cms.listFacets({ scope: "radio" as never })).toEqual([]);
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

  it("filtre par activité, et donne les étiquettes de chacun", async () => {
    const djs = await cms.listArtists({ tag: "dj" });
    expect(djs.groups.flatMap((group) => group.artists).map((artist) => artist.slug)).toEqual(["exemple-bastien-ocre", "exemple-eloise-vachon", "exemple-yaya-kossi", "exemple-404-crew"]);
    const residents = await cms.listArtists({ role: "resident", tag: "podcast" });
    expect(residents.groups.flatMap((group) => group.artists).map((artist) => [artist.slug, artist.tags.map((tag) => tag.slug)])).toEqual([
      ["exemple-collectif-goutte-d-or", ["playlist", "podcast"]],
      ["exemple-eloise-vachon", ["dj", "podcast"]],
    ]);
    expect((await cms.listArtists({ tag: "pas une adresse" })).total).toBe(0);
  });

  it("donne la page d'un artiste avec ses étiquettes, ses shows, ses événements et les étiquettes de ses shows", async () => {
    const artist = await cms.getArtist("exemple-eloise-vachon");
    expect(artist).not.toBeNull();
    expect(artist!.role).toBe("resident");
    expect(artist!.photo?.credit).toBe("© Photographe exemple");
    expect(artist!.links).toHaveLength(2);
    expect(slugs(artist!.shows)).toEqual(["exemple-dimanche-house-a-la-chapelle", "exemple-ecologie-au-quotidien"]);
    // Son événement en brouillon n'apparaît pas.
    expect(slugs(artist!.events)).toEqual(["exemple-nuit-parabole", "exemple-talk-ecologie-sonore"]);
    expect(artist!.tags.map((tag) => tag.slug)).toEqual(["dj", "podcast"]);
    expect(artist!.showTags.map((tag) => tag.slug)).toEqual(expect.arrayContaining(["house", "deep-house", "militantisme", "exemple-ecologie"]));
  });

  it("n'a pas de page pour un artiste en brouillon", async () => {
    expect(await cms.getArtist("exemple-ana-brouillon")).toBeNull();
  });

  it("donne les voisins d'un artiste dans l'index de son rôle, en boucle comme les chaînes", async () => {
    // Les résidents : Bastien, Collectif, Éloïse ; après Éloïse, on revient à Bastien.
    const eloise = await cms.getArtist("exemple-eloise-vachon");
    expect(eloise!.neighbors?.previous.slug).toBe("exemple-collectif-goutte-d-or");
    expect(eloise!.neighbors?.next.slug).toBe("exemple-bastien-ocre");
    expect(eloise!.neighbors?.next.photo?.url).toBe(`${MEDIA_BASE}/exemples/portrait-bastien-ocre.webp`);
    // Les invités, dans l'ordre de la grille : Elle & Lui, Yaya, Zélie, puis 404 Crew sous #, sans Ana (brouillon).
    const crew = await cms.getArtist("exemple-404-crew");
    expect(crew!.neighbors?.previous.slug).toBe("exemple-zelie-marteau");
    expect(crew!.neighbors?.next.slug).toBe("exemple-elle-et-lui");
  });

  it("met chaque nom sous sa lettre", () => {
    expect(indexLetter("Éloïse")).toBe("E");
    expect(indexLetter("« Zélie »")).toBe("Z");
    expect(indexLetter("œil")).toBe("O");
    expect(indexLetter("404 Crew")).toBe("#");
    expect(indexLetter("")).toBe("#");
  });
});

describe("diffusions", () => {
  const HOUR = 3_600_000;
  const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

  it("donne les shows publiés de durée connue qui passent dans l'intervalle, avec leurs artistes publiés", async () => {
    // Le dimanche house d'Éloïse, il y a trois jours, deux heures durant : une minute en son milieu le trouve.
    const pendant = await cms.listAirings({ from: at(-71), to: at(-71 + 1 / 60) });
    expect(slugs(pendant)).toEqual(["exemple-dimanche-house-a-la-chapelle"]);
    expect(pendant[0]!.artists).toEqual(["exemple-eloise-vachon"]);
    expect(pendant[0]!.startsAt).toEqual(at(-72));
    expect(pendant[0]!.endsAt).toEqual(at(-70));
    // Juste après sa fin, plus rien.
    expect(await cms.listAirings({ from: at(-70 + 1 / 3600), to: at(-69) })).toEqual([]);
    // La carte blanche : Yaya, sans Ana, en brouillon.
    expect((await cms.listAirings({ from: at(-48), to: at(-47.5) })).map((airing) => [airing.slug, airing.artists])).toEqual([
      ["exemple-carte-blanche", ["exemple-yaya-kossi"]],
    ]);
  });

  it("laisse de côté les brouillons, et rend la session à venir quand l'intervalle l'atteint", async () => {
    // Le set en brouillon passait hier.
    expect(await cms.listAirings({ from: at(-24), to: at(-23.5) })).toEqual([]);
    expect(slugs(await cms.listAirings({ from: NOW, to: at(5 * 24) }))).toEqual(["exemple-session-a-venir"]);
  });

  it("ne rend rien pour un intervalle à l'envers ou une date invalide", async () => {
    expect(await cms.listAirings({ from: NOW, to: at(-1) })).toEqual([]);
    expect(await cms.listAirings({ from: new Date("pas une date"), to: NOW })).toEqual([]);
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
    expect(slugs((await cms.listEvents({ period: "past", tag: "rencontre-talk", now: NOW })).items)).toEqual(["exemple-talk-ecologie-sonore"]);
    expect(slugs((await cms.listEvents({ period: "upcoming", tag: "rencontre-talk", now: NOW })).items)).toEqual(["exemple-rencontre-radios-de-quartier"]);
    expect(slugs((await cms.listEvents({ period: "past", tag: "fete", now: NOW })).items)).toEqual(["exemple-soiree-speciale-anniversaire"]);
    expect((await cms.listEvents({ period: "past", tag: "evenement-special", now: NOW })).total).toBe(1);
    expect((await cms.listEvents({ period: "upcoming", tag: "concert", now: NOW })).total).toBe(0);
    expect((await cms.listEvents({ period: "upcoming", tag: "Concert !", now: NOW })).total).toBe(0);
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
    expect(expo!.tags).toEqual([{ slug: "live-session-art-ensemble", name: "Live session_Art ensemble" }]);
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
  it("encode un mot de passe à caractères spéciaux collé tel quel dans DATABASE_URL", () => {
    const fixed = normalizeDatabaseUrl("postgresql://postgres.ref:a&b+c#d_e@aws-0-eu-west-2.pooler.supabase.com:5432/postgres");
    const parsed = new URL(fixed);
    expect(decodeURIComponent(parsed.password)).toBe("a&b+c#d_e");
    expect([parsed.username, parsed.hostname, parsed.port, parsed.pathname]).toEqual(["postgres.ref", "aws-0-eu-west-2.pooler.supabase.com", "5432", "/postgres"]);
    expect(normalizeDatabaseUrl("postgres://u:p@localhost:5432/db")).toBe("postgres://u:p@localhost:5432/db");
    // L'erreur ne recopie jamais l'adresse, qui contient le mot de passe.
    expect(() => normalizeDatabaseUrl("postgresql://moi:secret@@")).toThrow(/^DATABASE_URL illisible/);
    expect(() => normalizeDatabaseUrl("postgresql://moi:secret@@")).not.toThrow(/secret/);
  });

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
