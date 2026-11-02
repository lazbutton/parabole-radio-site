/**
 * Les fonctions des écrans d'admin (src/admin/) : la saisie vérifiée, la tracklist collée, l'heure de Paris, puis les
 * lectures et les écritures sous le rôle d'un éditeur, et le refus d'un compte hors de l'équipe.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, emptyArtistForm, emptyShowForm, readArtistForm, readShowForm, type Admin, type ShowForm } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { fromParisInput, toParisInput } from "../src/paris.ts";
import { frenchOrder } from "../src/read/common.ts";
import { createReader } from "../src/read/index.ts";
import { artist, show, tag, track } from "../src/schema.ts";
import { formatTimecode, parseTimecode, parseTracklist } from "../src/tracklist.ts";
import { createAccount, exampleDb, MEDIA_BASE, NOW } from "./helpers.ts";

describe("les minutages", () => {
  it("lisent m:ss, mm:ss au-delà d'une heure, et h:mm:ss", () => {
    expect(parseTimecode("0:00")).toBe(0);
    expect(parseTimecode("12:30")).toBe(750);
    expect(parseTimecode("75:30")).toBe(4530);
    expect(parseTimecode(" 1:02:03 ")).toBe(3723);
  });

  it("refusent ce qui n'en est pas", () => {
    for (const text of ["", "12", "12:3", "12:60", "1:60:00", "1:02:60", "a:bc", "-1:00", "12.30"]) expect(parseTimecode(text)).toBeNull();
  });

  it("s'écrivent comme on les lit", () => {
    expect(formatTimecode(750)).toBe("12:30");
    expect(formatTimecode(5)).toBe("0:05");
    expect(formatTimecode(3723)).toBe("1:02:03");
    expect(formatTimecode(7200)).toBe("2:00:00");
  });
});

describe("une tracklist collée", () => {
  it("donne un morceau par ligne : minutage, artiste, titre", () => {
    expect(parseTracklist("0:00 Orchestre Imaginaire – Lumière de Barbès\n\n12:30 Les Fictifs - Boulevard de la Chapelle\n")).toEqual([
      { start: "0:00", artist: "Orchestre Imaginaire", title: "Lumière de Barbès", hopperUrl: "" },
      { start: "12:30", artist: "Les Fictifs", title: "Boulevard de la Chapelle", hopperUrl: "" },
    ]);
  });

  it("accepte numéros, crochets, minutage à la fin, guillemets et tiret long collé", () => {
    const lines = ["1. [00:00] Machine Fictive - Minuit pile", "#2 (7:30) Les Fictifs — « Tunnel »", "Brume Fictive – Rosée (1:02:03)", "Échos Inventés–Toits de Paris 9:10"];
    expect(parseTracklist(lines.join("\n"))).toEqual([
      { start: "00:00", artist: "Machine Fictive", title: "Minuit pile", hopperUrl: "" },
      { start: "7:30", artist: "Les Fictifs", title: "Tunnel", hopperUrl: "" },
      { start: "1:02:03", artist: "Brume Fictive", title: "Rosée", hopperUrl: "" },
      { start: "9:10", artist: "Échos Inventés", title: "Toits de Paris", hopperUrl: "" },
    ]);
  });

  it("ne coupe qu'au premier tiret entouré d'espaces", () => {
    expect(parseTracklist("Jay-Z - Song Cry - Live")).toEqual([{ start: "", artist: "Jay-Z", title: "Song Cry - Live", hopperUrl: "" }]);
  });

  it("garde un lien Hopper trouvé sur la ligne, et met tout le reste dans le titre sans séparateur", () => {
    expect(parseTracklist("3:00 Trio Fictif – Ballade du 18e https://hppr.fr/abc123")).toEqual([
      { start: "3:00", artist: "Trio Fictif", title: "Ballade du 18e", hopperUrl: "https://hppr.fr/abc123" },
    ]);
    expect(parseTracklist("Morceau sans artiste")).toEqual([{ start: "", artist: "", title: "Morceau sans artiste", hopperUrl: "" }]);
  });

  it("laisse de côté un intitulé, mais pas un titre qui finit par deux-points", () => {
    expect(parseTracklist("Tracklist :\nPlaylist:\n0:00 A – Un\nB - Titre : sous-titre:")).toEqual([
      { start: "0:00", artist: "A", title: "Un", hopperUrl: "" },
      { start: "", artist: "B", title: "Titre : sous-titre:", hopperUrl: "" },
    ]);
  });

  it("lit les cases d'un tableur", () => {
    expect(parseTracklist("1\t0:00\tQuartet Imaginaire\tRue Myrha\n8:20\tTrio Fictif\tBallade")).toEqual([
      { start: "0:00", artist: "Quartet Imaginaire", title: "Rue Myrha", hopperUrl: "" },
      { start: "8:20", artist: "Trio Fictif", title: "Ballade", hopperUrl: "" },
    ]);
  });
});

describe("l'heure de Paris", () => {
  it("passe d'un champ datetime-local à l'instant, l'été comme l'hiver", () => {
    expect(fromParisInput("2026-06-13T18:00")?.toISOString()).toBe("2026-06-13T16:00:00.000Z");
    expect(fromParisInput("2026-12-01T18:00")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(toParisInput(new Date("2026-06-13T16:00:00Z"))).toBe("2026-06-13T18:00");
    expect(toParisInput(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01T00:30");
  });

  it("tient les changements d'heure", () => {
    // Le 29 mars 2026, 2 h 30 n'existe pas à Paris : on passe à 3 h 30.
    expect(fromParisInput("2026-03-29T02:30")?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(fromParisInput("2026-03-29T01:30")?.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    // Le 25 octobre 2026, 2 h 30 existe deux fois : la seconde, à l'heure d'hiver.
    expect(fromParisInput("2026-10-25T02:30")?.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(fromParisInput("2026-10-25T01:30")?.toISOString()).toBe("2026-10-24T23:30:00.000Z");
  });

  it("refuse une date qui n'existe pas", () => {
    for (const text of ["", "2026-02-30T12:00", "2026-06-13T24:00", "2026-13-01T10:00", "13/06/2026 18:00"]) expect(fromParisInput(text)).toBeNull();
  });
});

const showForm = (fields: Partial<ShowForm>): ShowForm => ({ ...emptyShowForm(), type: "dj_set", ...fields });

describe("la fiche d'un show, vérifiée", () => {
  it("exige un titre et un type, et tire l'adresse du titre", () => {
    expect(readShowForm(emptyShowForm()).errors).toMatchObject({ title: expect.any(String), type: expect.any(String) });
    const { values, errors } = readShowForm(showForm({ title: "  Nuit   Parabole #3 " }));
    expect(errors).toEqual({});
    expect(values).toMatchObject({ title: "Nuit Parabole #3", slug: "nuit-parabole-3", slugFromTitle: true, broadcastAt: null, artists: [], tags: [], tracks: [] });
    expect(readShowForm(showForm({ title: "x", slug: "Mon Adresse" })).values).toMatchObject({ slug: "mon-adresse", slugFromTitle: false });
  });

  it("exige une date de diffusion pour publier", () => {
    expect(readShowForm(showForm({ title: "Sans date" }), { publish: true }).errors.broadcastAt).toBe("Il faut une date de diffusion pour publier.");
    const { values, errors } = readShowForm(showForm({ title: "Daté", broadcastAt: "2026-06-13T18:00" }), { publish: true });
    expect(errors).toEqual({});
    expect(values.broadcastAt?.toISOString()).toBe("2026-06-13T16:00:00.000Z");
  });

  it("vérifie la durée, la piste SoundCloud et chaque morceau", () => {
    const { errors } = readShowForm(
      showForm({
        title: "Erreurs",
        duration: "deux heures",
        soundcloudUrl: "https://example.com/piste",
        soundcloudTrackId: "abc",
        tracks: [
          { artist: "A", title: "", start: "1:00", hopperUrl: "" },
          { artist: "", title: "", start: "", hopperUrl: "" },
          { artist: "B", title: "Deux", start: "1:75", hopperUrl: "https://example.com/x" },
        ],
      }),
    );
    // La ligne vide disparaît : la troisième devient la deuxième.
    expect(errors).toEqual({
      duration: expect.any(String),
      soundcloudUrl: expect.any(String),
      soundcloudTrackId: expect.any(String),
      "tracks.0.title": "Le titre manque.",
      "tracks.1.start": expect.any(String),
      "tracks.1.hopperUrl": expect.any(String),
    });
  });

  it("ajoute la tracklist collée à la fin, et rend la fiche remise au propre", () => {
    const { form, values, errors } = readShowForm(
      showForm({ title: "Collée", duration: "1:30:00", tracks: [{ artist: "A", title: "Un", start: "0:00", hopperUrl: "" }], pasted: "4:10 B – Deux\n9:00 C - Trois" }),
    );
    expect(errors).toEqual({});
    expect(form.pasted).toBe("");
    expect(form.tracks.map((line) => line.title)).toEqual(["Un", "Deux", "Trois"]);
    expect(values.durationSeconds).toBe(5400);
    expect(values.tracks).toEqual([
      { artist: "A", title: "Un", startSeconds: 0, hopperUrl: null },
      { artist: "B", title: "Deux", startSeconds: 250, hopperUrl: null },
      { artist: "C", title: "Trois", startSeconds: 540, hopperUrl: null },
    ]);
  });

  it("lit les artistes et les étiquettes choisis, nouveaux compris, sans doublon", () => {
    const id = "6f1c1f0e-8c2a-4b8e-9a51-0d1c2b3a4f5e";
    const { values } = readShowForm(
      showForm({ title: "Choix", artists: [id, "nouveau:  Nouvelle   Voix ", id.toUpperCase(), "nouveau:", "n'importe quoi"], tags: ["nouveau:Afro House", "nouveau:afro-house", "nouveau:  ", id, "rouge"] }),
    );
    expect(values.artists).toEqual([{ id }, { name: "Nouvelle Voix" }]);
    expect(values.tags).toEqual([{ name: "Afro House" }, { id }]);
  });

  it("lit le mood d'un DJ set ou d'une playlist, pas celui d'un podcast", () => {
    expect(readShowForm(showForm({ title: "Mood", energy: "4" })).values.energy).toBe(4);
    expect(readShowForm(showForm({ title: "Mood", energy: "" })).values.energy).toBeNull();
    expect(readShowForm(showForm({ title: "Mood", type: "podcast", energy: "4" })).values.energy).toBeNull();
    expect(readShowForm(showForm({ title: "Mood", energy: "9" })).errors.energy).toBe("Un cran de 1 à 5.");
    expect(readShowForm(showForm({ title: "Mood", energy: "2.5" })).errors.energy).toBe("Un cran de 1 à 5.");
  });
});

describe("la fiche d'un artiste, vérifiée", () => {
  it("exige un nom et un rôle, et vérifie les liens", () => {
    expect(readArtistForm({ ...emptyArtistForm(), role: "" }).errors).toMatchObject({ name: expect.any(String), role: expect.any(String) });
    const { values, errors } = readArtistForm({
      ...emptyArtistForm(),
      name: "Éloïse",
      links: [
        { label: "", url: "https://www.instagram.com/eloise" },
        { label: "", url: "" },
        { label: "Site", url: "pas une adresse" },
        { label: "Son label", url: "https://label.example/eloise" },
      ],
    });
    expect(errors).toEqual({ "links.1.url": "Une adresse complète : https://…" });
    expect(values.slug).toBe("eloise");
    expect(values.links[0]).toEqual({ label: "Instagram", url: "https://www.instagram.com/eloise" });
    expect(values.links[2]).toEqual({ label: "Son label", url: "https://label.example/eloise" });
  });

  it("complète une adresse collée sans https://", () => {
    const { form, values, errors } = readArtistForm({ ...emptyArtistForm(), name: "X", links: [{ label: "", url: "instagram.com/x" }, { label: "Site", url: "www.site.fr" }] });
    expect(errors).toEqual({});
    expect(values.links).toEqual([
      { label: "Instagram", url: "https://instagram.com/x" },
      { label: "Site", url: "https://www.site.fr" },
    ]);
    expect(form.links[0]!.url).toBe("https://instagram.com/x");
    const show = readShowForm(showForm({ title: "S", soundcloudUrl: "soundcloud.com/parabole/x", tracks: [{ artist: "A", title: "B", start: "", hopperUrl: "hppr.fr/abc" }] }));
    expect(show.errors).toEqual({});
    expect(show.values).toMatchObject({ soundcloudUrl: "https://soundcloud.com/parabole/x", tracks: [{ hopperUrl: "https://hppr.fr/abc" }] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Dans la base, sous les rôles de Supabase
// ---------------------------------------------------------------------------------------------------------------

let connection: Connection;
let editor: Admin;
let stranger: Admin;

beforeAll(async () => {
  connection = await exampleDb();
  editor = createAdmin(connection.db, await createAccount(connection.db, "editor"));
  stranger = createAdmin(connection.db, await createAccount(connection.db));
});
afterAll(() => connection?.close());

const publicReader = () => createReader(connection.db, { mediaBaseUrl: MEDIA_BASE });

/** Enregistre une fiche de show saisie comme à l'écran ; l'échec d'un test qui l'attend réussie se lit tout de suite. */
async function saveForm(admin: Admin, fields: Partial<ShowForm>, options: { id?: string; version?: string; publish?: boolean; unpublish?: boolean } = {}) {
  const { values, errors } = readShowForm(showForm(fields), { publish: options.publish });
  expect(errors).toEqual({});
  return admin.saveShow({ id: options.id, version: options.version, values, status: options.publish ? "published" : options.unpublish ? "draft" : undefined });
}

describe("l'équipe", () => {
  it("reconnaît un membre, pas un compte hors de l'équipe", async () => {
    expect(await editor.member()).toMatchObject({ role: "editor", name: "Membre editor" });
    expect(await stranger.member()).toBeNull();
  });

  it("refuse toute écriture à un compte hors de l'équipe", async () => {
    const result = await saveForm(stranger, { title: "Intrus" });
    expect(result).toEqual({ ok: false, errors: { form: expect.stringContaining("refuse") } });
    expect(await stranger.listShows()).toMatchObject({ total: 8 }); // il ne voit que le publié
    expect(await stranger.deleteShow((await editor.listShows({ q: "Matin calme" })).items[0]!.id)).toBeNull();
    expect((await editor.listShows({ q: "Matin calme" })).total).toBe(1);
  });
});

describe("les shows dans l'admin", () => {
  it("liste les brouillons aussi, avec filtres et recherche", async () => {
    const all = await editor.listShows();
    expect(all.total).toBe(9);
    expect((await editor.listShows({ status: "draft" })).items.map((row) => row.slug)).toEqual(["exemple-set-non-publie"]);
    expect((await editor.listShows({ type: "podcast" })).total).toBe(2);
    // La recherche trouve par le titre, l'artiste (brouillon compris) et la tracklist.
    expect((await editor.listShows({ q: "dimanche" })).items.map((row) => row.slug)).toEqual(["exemple-dimanche-house-a-la-chapelle"]);
    expect((await editor.listShows({ q: "ana brouillon" })).items.map((row) => row.slug).sort()).toEqual(["exemple-carte-blanche", "exemple-set-non-publie"]);
    expect((await editor.listShows({ q: "confidentiel" })).items.map((row) => row.slug)).toEqual(["exemple-set-non-publie"]);
    const [anArtist] = await connection.db.select({ id: artist.id }).from(artist).where(eq(artist.slug, "exemple-yaya-kossi"));
    expect((await editor.listShows({ artist: anArtist!.id })).total).toBe(2);
    const [techno] = await connection.db.select({ id: tag.id }).from(tag).where(eq(tag.slug, "techno"));
    expect((await editor.listShows({ tag: techno!.id })).total).toBe(3);
    // Un groupe vaut pour ses étiquettes : House / techno trouve aussi les shows House, Deep house, Detroit techno.
    const [houseTechno] = await connection.db.select({ id: tag.id }).from(tag).where(eq(tag.slug, "house-techno"));
    expect((await editor.listShows({ tag: houseTechno!.id })).total).toBe(5);
    // Une valeur inconnue dans l'adresse ne casse rien.
    expect((await editor.listShows({ status: "perdu", type: "?", tag: "pas-un-id" })).total).toBe(9);
    const row = all.items.find((item) => item.slug === "exemple-techno-de-minuit")!;
    expect(row).toMatchObject({ artists: ["Bastien Ocre (exemple)", "Yaya Kossi (exemple)"], tracks: 4, hasSound: true, fromRadioCult: false });
  });

  it("trouve les shows déjà diffusés sans tracklist ou sans son, brouillons compris", async () => {
    const slugs = async (missing: string) => (await editor.listShows({ missing, now: NOW })).items.map((row) => row.slug).sort();
    expect(await slugs("tracklist")).toEqual(["exemple-carte-blanche", "exemple-ecologie-au-quotidien", "exemple-voix-de-la-goutte-d-or"]);
    expect(await slugs("sound")).toEqual(["exemple-carte-blanche", "exemple-ecologie-au-quotidien", "exemple-jazz-du-marche-dejean", "exemple-set-non-publie", "exemple-voix-de-la-goutte-d-or"]);
    // Un show à venir ne manque encore de rien ; une valeur inconnue ne filtre pas.
    expect((await editor.listShows({ missing: "sound", now: new Date(NOW.getTime() + 10 * 24 * 3600_000) })).items.map((row) => row.slug)).toContain("exemple-session-a-venir");
    expect((await editor.listShows({ missing: "?", now: NOW })).total).toBe(9);
  });

  it("crée un show en brouillon avec un nouvel artiste, une nouvelle étiquette et sa tracklist", async () => {
    const [eloise] = await connection.db.select({ id: artist.id }).from(artist).where(eq(artist.slug, "exemple-eloise-vachon"));
    const saved = await saveForm(editor, {
      title: "Essai de l'admin",
      broadcastAt: "2026-06-20T20:00",
      duration: "2:00:00",
      description: "Une **description**.",
      artists: [eloise!.id, "nouveau:Invitée Toute Neuve"],
      tags: ["nouveau:Bouillon de genres"],
      energy: "3",
      pasted: "0:00 Orchestre Imaginaire – Ouverture\n5:00 Les Fictifs - Suite https://hppr.fr/suite",
    });
    expect(saved).toMatchObject({ ok: true, slug: "essai-de-l-admin", newArtists: ["Invitée Toute Neuve"], newTags: ["Bouillon de genres"] });
    if (!saved.ok) return;
    const loaded = await editor.getShow(saved.id);
    expect(loaded).toMatchObject({ title: "Essai de l'admin", status: "draft", durationSeconds: 7200, energy: 3, description: "Une **description**." });
    expect(loaded!.broadcastAt?.toISOString()).toBe("2026-06-20T18:00:00.000Z");
    expect(loaded!.artists.map((one) => [one.name, one.status])).toEqual([
      ["Éloïse Vachon (exemple)", "published"],
      ["Invitée Toute Neuve", "draft"],
    ]);
    expect(loaded!.tags).toEqual([{ id: expect.any(String), name: "Bouillon de genres" }]);
    // La nouvelle étiquette n'a pas encore de place dans les filtres : elle est à classer.
    const { tags: choices } = await editor.showChoices();
    expect(choices.find((one) => one.name === "Bouillon de genres")).toMatchObject({ places: [] });
    expect(loaded!.tracks).toEqual([
      { artist: "Orchestre Imaginaire", title: "Ouverture", startSeconds: 0, hopperUrl: null },
      { artist: "Les Fictifs", title: "Suite", startSeconds: 300, hopperUrl: "https://hppr.fr/suite" },
    ]);
    // Le nouvel artiste naît en brouillon, invité, avec une adresse tirée de son nom.
    const [born] = await connection.db.select().from(artist).where(eq(artist.name, "Invitée Toute Neuve"));
    expect(born).toMatchObject({ slug: "invitee-toute-neuve", role: "guest", status: "draft" });
    // Encore un brouillon : le site ne le voit pas.
    expect(await publicReader().getShow("essai-de-l-admin")).toBeNull();
  });

  it("retrouve un artiste et une étiquette existants sous un nom tapé autrement, sans doublon", async () => {
    // Par le nom, sans accents ni majuscules : « coupe decale » retrouve « Coupé-décalé », « QUARTIER (exemple) » l'étiquette d'exemple.
    const saved = await saveForm(editor, { title: "Retrouvailles", artists: ["nouveau:eloise VACHON (exemple)"], tags: ["nouveau:COUPE-DECALE", "nouveau:quartier (EXEMPLE)"] });
    expect(saved).toMatchObject({ ok: true, newArtists: [], newTags: [] });
    if (!saved.ok) return;
    const loaded = await editor.getShow(saved.id);
    expect(loaded!.artists.map((one) => one.name)).toEqual(["Éloïse Vachon (exemple)"]);
    expect(loaded!.tags.map((one) => one.name)).toEqual(["Coupé-décalé", "Quartier (exemple)"]);
    // Par l'adresse : « disco  TROPICAL » retrouve « Disco tropical ».
    const first = await saveForm(editor, { title: "Disco 1", tags: ["nouveau:Disco tropical"] });
    const second = await saveForm(editor, { title: "Disco 2", tags: ["nouveau:disco  TROPICAL"] });
    expect([first, second]).toMatchObject([{ newTags: ["Disco tropical"] }, { newTags: [] }]);
  });

  it("numérote une adresse tirée du titre déjà prise, et refuse une adresse tapée déjà prise", async () => {
    const twin = await saveForm(editor, { title: "Matin calme (exemple)" });
    expect(twin).toMatchObject({ ok: true, slug: "matin-calme-exemple" });
    const again = await saveForm(editor, { title: "Matin calme (exemple)" });
    expect(again).toMatchObject({ ok: true, slug: "matin-calme-exemple-2" });
    const typed = await saveForm(editor, { title: "Autre", slug: "exemple-matin-calme" });
    expect(typed).toEqual({ ok: false, errors: { slug: "Cette adresse sert déjà au show « Matin calme (exemple) »." } });
  });

  it("publie avec une date de diffusion, puis dépublie", async () => {
    const created = await saveForm(editor, { title: "À publier", broadcastAt: "2026-06-01T21:00" });
    if (!created.ok) throw new Error("création refusée");
    const loaded = await editor.getShow(created.id);
    const published = await saveForm(editor, { title: "À publier", slug: loaded!.slug, broadcastAt: "2026-06-01T21:00" }, { id: created.id, version: loaded!.version, publish: true });
    expect(published).toMatchObject({ ok: true });
    expect(await publicReader().getShow("a-publier")).toMatchObject({ title: "À publier" });
    const after = await editor.getShow(created.id);
    await saveForm(editor, { title: "À publier", slug: after!.slug, broadcastAt: "2026-06-01T21:00" }, { id: created.id, version: after!.version, unpublish: true });
    expect(await publicReader().getShow("a-publier")).toBeNull();
  });

  it("refuse de publier sans date, même quand l'écran l'oublie, et garde la date d'un show publié", async () => {
    const created = await saveForm(editor, { title: "Sans date" });
    if (!created.ok) throw new Error("création refusée");
    const { values } = readShowForm(showForm({ title: "Sans date" }));
    expect(await editor.saveShow({ id: created.id, values, status: "published" })).toEqual({ ok: false, errors: { broadcastAt: "Il faut une date de diffusion pour publier." } });
    // Un show déjà publié qui perd sa date : refusé aussi, même sans changer de statut.
    const [published] = await connection.db.select({ id: show.id }).from(show).where(eq(show.slug, "exemple-matin-calme"));
    const cleared = readShowForm(showForm({ title: "Matin calme (exemple)", slug: "exemple-matin-calme", type: "playlist" })).values;
    expect(await editor.saveShow({ id: published!.id, values: cleared })).toEqual({ ok: false, errors: { broadcastAt: "Il faut une date de diffusion pour publier." } });
  });

  it("remplace toute la tracklist à chaque enregistrement", async () => {
    const created = await saveForm(editor, { title: "Tracklist", pasted: "0:00 A - Un\n1:00 B - Deux\n2:00 C - Trois" });
    if (!created.ok) throw new Error("création refusée");
    const saved = await saveForm(editor, { title: "Tracklist", slug: created.slug, tracks: [{ artist: "C", title: "Trois", start: "0:00", hopperUrl: "" }, { artist: "A", title: "Un", start: "2:00", hopperUrl: "" }] }, { id: created.id });
    expect(saved).toMatchObject({ ok: true });
    const lines = await connection.db.select({ position: track.position, title: track.title }).from(track).where(eq(track.showId, created.id)).orderBy(track.position);
    expect(lines).toEqual([
      { position: 1, title: "Trois" },
      { position: 2, title: "Un" },
    ]);
  });

  it("prévient quand quelqu'un a enregistré entre-temps, puis accepte de remplacer sa version", async () => {
    const created = await saveForm(editor, { title: "Conflit" });
    if (!created.ok) throw new Error("création refusée");
    const opened = await editor.getShow(created.id);
    await saveForm(editor, { title: "Conflit (version de l'autre)", slug: opened!.slug }, { id: created.id, version: opened!.version });
    const late = await saveForm(editor, { title: "Conflit (ma version)", slug: opened!.slug }, { id: created.id, version: opened!.version });
    expect(late).toMatchObject({ ok: false, version: expect.any(String), errors: { form: expect.stringContaining("pendant que tu le modifiais") } });
    if (late.ok) return;
    expect(await saveForm(editor, { title: "Conflit (ma version)", slug: opened!.slug }, { id: created.id, version: late.version })).toMatchObject({ ok: true });
    expect((await editor.getShow(created.id))!.title).toBe("Conflit (ma version)");
  });

  it("traduit un refus de la base en erreur de champ", async () => {
    // La piste SoundCloud d'un autre show : la saisie est bien formée, c'est la base qui refuse le doublon.
    const result = await saveForm(editor, { title: "Doublon de piste", soundcloudTrackId: "1000000001" });
    expect(result).toEqual({ ok: false, errors: { soundcloudTrackId: "Cette piste SoundCloud est déjà liée à un autre show." } });
    expect((await editor.listShows({ q: "Doublon de piste" })).total).toBe(0);
  });

  it("supprime un show et sa tracklist", async () => {
    const created = await saveForm(editor, { title: "À supprimer", pasted: "0:00 A - Un" });
    if (!created.ok) throw new Error("création refusée");
    expect(await editor.deleteShow(created.id)).toEqual({ title: "À supprimer", coverId: null });
    expect(await editor.getShow(created.id)).toBeNull();
    expect(await connection.db.select().from(track).where(eq(track.showId, created.id))).toEqual([]);
    expect(await editor.deleteShow(created.id)).toBeNull();
  });

  it("propose tous les artistes dans l'ordre alphabétique, et les étiquettes des shows avec leurs places", async () => {
    const { artists, tags, facets } = await editor.showChoices();
    const names = artists.map((one) => one.name);
    expect(names).toContain("Ana Brouillon (exemple)");
    expect(names).toEqual([...names].sort(frenchOrder.compare));
    expect(facets.map((one) => [one.name, one.showTypes, one.groups.length])).toEqual([
      ["Thème", ["podcast"], 3],
      ["Genre", ["dj_set", "playlist"], 14],
      ["Géographie", ["dj_set", "playlist"], 5],
    ]);
    // De quoi choisir à la souris : les groupes dans l'ordre, leurs étiquettes dans l'ordre alphabétique.
    const nameOf = (id: string) => tags.find((one) => one.id === id)?.name;
    const theme = facets[0]!;
    expect(theme.groups.map((group) => nameOf(group.tagId))).toEqual(["Culture", "Société", "Musique"]);
    expect(theme.groups[2]!.members.map(nameOf)).toEqual(["Actualité musicale", "Histoire de la musique"]);
    // Dans l'ordre des filtres et de leurs groupes : Thème › Culture et ses étiquettes d'abord.
    const tagNames = tags.map((one) => one.name);
    expect(tagNames.slice(0, 4)).toEqual(["Culture", "Architecture", "Art", "Cinéma"]);
    // Amapiano a deux places ; Club est un groupe ; les activités des artistes et les catégories d'événements n'y sont pas.
    const facetOf = (name: string) => facets.find((one) => one.name === name)!.id;
    const amapiano = tags.find((one) => one.name === "Amapiano")!;
    const club = tags.find((one) => one.name === "Club")!;
    expect(amapiano.places).toEqual(expect.arrayContaining([{ facetId: facetOf("Genre"), groupId: club.id }, expect.objectContaining({ facetId: facetOf("Géographie") })]));
    expect(club.places).toEqual([{ facetId: facetOf("Genre"), groupId: null }]);
    expect(tagNames).not.toContain("DJ");
    expect(tagNames).not.toContain("Fête");
    // Les étiquettes à classer sont proposées aussi, sans place.
    expect(tags.find((one) => one.name === "Quartier (exemple)")).toMatchObject({ places: [] });
  });
});

describe("les artistes dans l'admin", () => {
  it("rangent tout le monde par lettre, brouillons compris, avec des filtres", async () => {
    const index = await editor.listArtists();
    expect(index.groups.map((group) => group.letter)).toEqual([...index.groups.map((group) => group.letter)].sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))));
    const names = index.groups.flatMap((group) => group.artists.map((one) => one.name));
    expect(names).toContain("Ana Brouillon (exemple)");
    expect(index.groups.find((group) => group.letter === "E")!.artists.map((one) => one.name)).toEqual(expect.arrayContaining(["Éloïse Vachon (exemple)", "Elle & Lui (exemple)"]));
    expect(index.groups.at(-1)).toMatchObject({ letter: "#", artists: [expect.objectContaining({ name: "404 Crew (exemple)" })] });
    expect((await editor.listArtists({ status: "draft" })).groups.flatMap((group) => group.artists.map((one) => one.name))).toEqual(expect.arrayContaining(["Ana Brouillon (exemple)"]));
    expect((await editor.listArtists({ role: "resident", q: "bastien" })).total).toBe(1);
  });

  it("trouvent les fiches sans photo ou sans bio", async () => {
    // Les artistes nés d'un show (tests plus haut) n'ont ni photo ni bio : on regarde les exemples, et ce qui change.
    const rows = async (missing: string) => (await editor.listArtists({ missing })).groups.flatMap((group) => group.artists);
    const withoutPhoto = await rows("photo");
    const examples = withoutPhoto.filter((one) => one.slug.startsWith("exemple-")).map((one) => one.slug).sort();
    expect(examples).toEqual(["exemple-404-crew", "exemple-collectif-goutte-d-or", "exemple-elle-et-lui", "exemple-yaya-kossi", "exemple-zelie-marteau"]);
    expect(withoutPhoto.every((one) => !one.hasPhoto)).toBe(true);
    const before = await rows("bio");
    expect(before.some((one) => one.slug.startsWith("exemple-"))).toBe(false);
    const { values } = readArtistForm({ name: "Sans Bio", slug: "", role: "guest", bio: "   ", links: [], tags: [] });
    const created = await editor.saveArtist({ values });
    const after = await rows("bio");
    expect(after.length).toBe(before.length + 1);
    expect(after.find((one) => one.name === "Sans Bio")).toMatchObject({ hasBio: false });
    expect(after.every((one) => !one.hasBio)).toBe(true);
    if (created.ok) await editor.deleteArtist(created.id);
  });

  it("créent, publient et suppriment une fiche, liens et étiquettes compris", async () => {
    const [podcast] = await connection.db.select({ id: tag.id }).from(tag).where(eq(tag.slug, "podcast"));
    const { values } = readArtistForm({
      name: "Nouvelle Résidente",
      slug: "",
      role: "resident",
      bio: "Une bio.",
      links: [{ label: "", url: "https://soundcloud.com/nouvelle" }],
      tags: [podcast!.id, "pas-un-id", podcast!.id],
    });
    const created = await editor.saveArtist({ values });
    expect(created).toMatchObject({ ok: true, slug: "nouvelle-residente" });
    if (!created.ok) return;
    const loaded = await editor.getArtist(created.id);
    expect(loaded).toMatchObject({ name: "Nouvelle Résidente", role: "resident", status: "draft", links: [{ label: "SoundCloud", url: "https://soundcloud.com/nouvelle" }], shows: [], events: 0 });
    expect(loaded!.tags).toEqual([{ id: podcast!.id, name: "Podcast" }]);
    expect((await editor.listArtists({ tag: podcast!.id, q: "nouvelle" })).total).toBe(1);
    expect(await editor.saveArtist({ id: created.id, version: loaded!.version, values: { ...values, slug: loaded!.slug, slugFromTitle: false }, status: "published" })).toMatchObject({ ok: true });
    expect(await publicReader().getArtist("nouvelle-residente")).toMatchObject({ name: "Nouvelle Résidente", tags: [{ slug: "podcast", name: "Podcast" }] });
    expect(await editor.deleteArtist(created.id)).toEqual({ name: "Nouvelle Résidente", photoId: null });
    expect(await publicReader().getArtist("nouvelle-residente")).toBeNull();
  });

  it("montrent les shows d'un artiste, brouillons compris, et le retirent des shows quand on le supprime", async () => {
    const [ana] = await connection.db.select({ id: artist.id }).from(artist).where(eq(artist.slug, "exemple-ana-brouillon"));
    const loaded = await editor.getArtist(ana!.id);
    expect(loaded!.shows.map((one) => [one.title, one.status])).toEqual(
      expect.arrayContaining([
        ["Set non publié (exemple)", "draft"],
        ["Carte blanche (exemple)", "published"],
      ]),
    );
    const typed = readArtistForm({ name: "Ana", slug: "exemple-bastien-ocre", role: "guest", bio: "", links: [], tags: [] }).values;
    expect(await editor.saveArtist({ id: ana!.id, values: typed })).toEqual({ ok: false, errors: { slug: "Cette adresse sert déjà à « Bastien Ocre (exemple) »." } });
    expect(await stranger.deleteArtist(ana!.id)).toBeNull();
    // Sa photo est rendue, pour être retirée si elle ne sert plus.
    expect(await editor.deleteArtist(ana!.id)).toEqual({ name: "Ana Brouillon (exemple)", photoId: expect.any(String) });
    const carte = (await editor.listShows({ q: "Carte blanche" })).items[0]!;
    expect(carte.artists).toEqual(["Yaya Kossi (exemple)"]);
  });
});

describe("le tableau de bord", () => {
  it("compte les contenus et montre les derniers brouillons", async () => {
    const overview = await editor.overview();
    expect(overview.shows.published).toBeGreaterThanOrEqual(8);
    expect(overview.shows.draft).toBeGreaterThanOrEqual(1);
    expect(overview.drafts.length).toBeGreaterThan(0);
    const dates = overview.drafts.map((draft) => draft.updatedAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("annonce les prochaines diffusions, et compte ce qui manque comme le font les listes", async () => {
    const overview = await editor.overview({ now: NOW });
    expect(overview.upcoming.map((one) => one.title)).toContain("Session à venir (exemple)");
    const times = overview.upcoming.map((one) => one.broadcastAt.getTime());
    expect(times.every((time) => time > NOW.getTime())).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(overview.upcoming.find((one) => one.title === "Session à venir (exemple)")).toMatchObject({ type: "dj_set", artists: ["404 Crew (exemple)"] });
    // Le nombre annoncé est celui de la liste filtrée où mène le tableau de bord.
    expect(overview.missing.tracklist).toBe((await editor.listShows({ missing: "tracklist", now: NOW })).total);
    expect(overview.missing.sound).toBe((await editor.listShows({ missing: "sound", now: NOW })).total);
    expect(overview.missing.photo).toBe((await editor.listArtists({ missing: "photo" })).total);
    expect(overview.missing.bio).toBe((await editor.listArtists({ missing: "bio" })).total);
    expect(overview.missing.tracklist).toBeGreaterThan(0);
  });
});
