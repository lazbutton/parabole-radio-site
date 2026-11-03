/**
 * Les événements dans l'admin (src/admin/events.ts) : la saisie vérifiée, la liste (à venir d'abord, puis les passés),
 * l'enregistrement avec sa catégorie et ses artistes, le visuel et la galerie, qui changent sur place, la suppression,
 * et ce que le site en lit ensuite.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, emptyEventForm, readCaption, readEventForm, type Admin, type EventForm, type MediaUpload } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { artist, event, media, tag } from "../src/schema.ts";
import { createAccount, exampleDb, MEDIA_BASE, NOW } from "./helpers.ts";

let connection: Connection;
let editor: Admin;
let stranger: Admin;

beforeAll(async () => {
  connection = await exampleDb();
  editor = createAdmin(connection.db, await createAccount(connection.db, "editor"));
  stranger = createAdmin(connection.db, await createAccount(connection.db));
});
afterAll(() => connection?.close());

const site = () => createReader(connection.db, { mediaBaseUrl: MEDIA_BASE });
const idOf = async (table: typeof artist | typeof tag | typeof event, slug: string) => (await connection.db.select({ id: table.id }).from(table).where(eq(table.slug, slug)))[0]!.id;

/** Enregistre une fiche remplie à partir d'une fiche vide. */
async function saveForm(admin: Admin, fields: Partial<EventForm>, options: { id?: string; version?: string; status?: "draft" | "published" } = {}) {
  const read = readEventForm({ ...emptyEventForm(), ...fields }, { publish: options.status === "published" });
  if (Object.keys(read.errors).length) return { ok: false as const, errors: read.errors };
  return admin.saveEvent({ id: options.id, version: options.version, values: read.values, status: options.status });
}

let count = 0;
/** Une image telle que le site l'inscrit après l'envoi. */
function upload(fields: Partial<MediaUpload> = {}): MediaUpload {
  const name = `images/2026/11/${String(++count).padStart(8, "0")}-0000-4000-8000-00000000e7e7`;
  return { key: `${name}-1600.webp`, sizeBytes: 150_000, width: 1600, height: 1067, alt: "Le public devant la scène", credit: null, variants: [{ width: 400, key: `${name}-400.webp` }], ...fields };
}
async function added(fields: Partial<MediaUpload> = {}) {
  const result = await editor.addMedia(upload(fields));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.media;
}

describe("la fiche d'un événement, vérifiée", () => {
  it("exige un titre et un début, même en brouillon, et tire l'adresse du titre", () => {
    expect(readEventForm(emptyEventForm()).errors).toEqual({ title: expect.any(String), startsAt: expect.any(String) });
    const read = readEventForm({ ...emptyEventForm(), title: "  Nuit   blanche à l'Olympic ", startsAt: "2026-06-20T20:00" });
    expect(read.errors).toEqual({});
    expect(read.values).toMatchObject({ title: "Nuit blanche à l'Olympic", slug: "nuit-blanche-a-l-olympic", slugFromTitle: true, endsAt: null, ticketUrl: null });
    expect(read.values.startsAt.toISOString()).toBe("2026-06-20T18:00:00.000Z");
  });

  it("veut une fin après le début, et une vraie adresse d'inscription, complétée au besoin", () => {
    const base = { ...emptyEventForm(), title: "Atelier", startsAt: "2026-06-20T20:00" };
    expect(readEventForm({ ...base, endsAt: "2026-06-20T19:00" }).errors).toEqual({ endsAt: "La fin vient avant le début." });
    expect(readEventForm({ ...base, endsAt: "2026-06-31T19:00" }).errors).toEqual({ endsAt: "Cette date n'existe pas." });
    expect(readEventForm({ ...base, ticketUrl: "pas une adresse" }).errors).toEqual({ ticketUrl: expect.any(String) });
    const read = readEventForm({ ...base, endsAt: "2026-06-21T02:00", ticketUrl: "shotgun.live/fr/events/atelier" });
    expect(read.errors).toEqual({});
    expect(read.values.ticketUrl).toBe("https://shotgun.live/fr/events/atelier");
    expect(read.values.endsAt?.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });

  it("exige une catégorie pour publier", () => {
    const base = { ...emptyEventForm(), title: "Atelier", startsAt: "2026-06-20T20:00" };
    expect(readEventForm(base, { publish: true }).errors).toEqual({ tags: "Choisis sa catégorie pour publier." });
    expect(readEventForm({ ...base, tags: ["nouveau:Workshop"] }, { publish: true }).errors).toEqual({});
  });

  it("garde une légende de photo courte", () => {
    expect(readCaption("  Le   vernissage ")).toEqual({ caption: "Le vernissage", errors: {} });
    expect(readCaption("")).toEqual({ caption: null, errors: {} });
    expect(readCaption("x".repeat(241)).errors).toEqual({ caption: expect.any(String) });
  });
});

describe("les événements dans l'admin", () => {
  it("les liste brouillons compris : à venir d'abord, du plus proche, puis les passés, du plus récent", async () => {
    const all = await editor.listEvents({ now: NOW });
    expect(all.total).toBe(7);
    expect(all.items.map((row) => [row.slug, row.upcoming])).toEqual([
      ["exemple-atelier-du-jour", true],
      ["exemple-nuit-parabole", true],
      ["exemple-rencontre-radios-de-quartier", true],
      ["exemple-evenement-brouillon", true],
      ["exemple-talk-ecologie-sonore", false],
      ["exemple-expo-sonore", false],
      ["exemple-soiree-speciale-anniversaire", false],
    ]);
    expect(all.items.find((row) => row.slug === "exemple-soiree-speciale-anniversaire")).toMatchObject({
      categories: ["Événement spécial", "Fête"],
      artists: ["Bastien Ocre (exemple)", "Yaya Kossi (exemple)", "Ana Brouillon (exemple)"],
      hasVisual: false,
      photos: 2,
    });
  });

  it("les filtrent par période, statut, catégorie et recherche", async () => {
    const slugs = async (filters: Parameters<Admin["listEvents"]>[0]) => (await editor.listEvents({ now: NOW, ...filters })).items.map((row) => row.slug);
    expect(await slugs({ period: "past" })).toEqual(["exemple-talk-ecologie-sonore", "exemple-expo-sonore", "exemple-soiree-speciale-anniversaire"]);
    expect(await slugs({ status: "draft" })).toEqual(["exemple-evenement-brouillon"]);
    expect(await slugs({ tag: await idOf(tag, "rencontre-talk") })).toEqual(["exemple-rencontre-radios-de-quartier", "exemple-talk-ecologie-sonore"]);
    // Le lieu et les artistes se cherchent aussi, sans les accents.
    expect((await slugs({ q: "bibliotheque" })).sort()).toEqual(["exemple-rencontre-radios-de-quartier", "exemple-talk-ecologie-sonore"]);
    expect(await slugs({ q: "zelie" })).toEqual(["exemple-expo-sonore"]);
    // Une valeur inconnue dans l'adresse ne casse rien.
    expect((await editor.listEvents({ period: "?", status: "perdu", tag: "pas-un-id" })).total).toBe(7);
  });

  it("propose les artistes et la catégorie des événements, rangée comme sur le site", async () => {
    const choices = await editor.eventChoices();
    expect(choices.facets.map((facet) => facet.name)).toEqual(["Catégorie"]);
    const names = new Map(choices.tags.map((one) => [one.id, one.name]));
    expect(choices.facets[0]!.groups.map((group) => names.get(group.tagId))).toContain("Fête");
    expect(choices.artists.some((one) => one.name === "Ana Brouillon (exemple)")).toBe(true);
  });

  it("crée un événement en brouillon avec un nouvel artiste, puis le publie avec sa catégorie", async () => {
    const eloise = await idOf(artist, "exemple-eloise-vachon");
    const fete = await idOf(tag, "fete");
    const saved = await saveForm(editor, {
      title: "Nuit Parabole (exemple)",
      startsAt: "2026-06-27T22:00",
      endsAt: "2026-06-28T05:00",
      venue: "La Goutte d'Or",
      address: "1 rue de l'Essai, 75018 Paris",
      description: "Une **nuit** d'essai.",
      ticketUrl: "https://example.com/billets",
      artists: ["nouveau:Invité Tout Neuf", eloise],
    });
    // L'adresse tirée du titre est déjà prise : elle reçoit un numéro.
    expect(saved).toMatchObject({ ok: true, slug: "nuit-parabole-exemple", newArtists: ["Invité Tout Neuf"] });
    if (!saved.ok) return;
    const draft = await editor.getEvent(saved.id);
    expect(draft).toMatchObject({ status: "draft", venue: "La Goutte d'Or", ticketUrl: "https://example.com/billets", tags: [], photos: [], visual: null });
    expect(draft!.artists.map((one) => [one.name, one.status])).toEqual([
      ["Invité Tout Neuf", "draft"],
      ["Éloïse Vachon (exemple)", "published"],
    ]);
    expect(await site().getEvent(saved.slug)).toBeNull();

    // Publier sans catégorie : refusé, même si l'écran l'oublie.
    const refused = await editor.saveEvent({ id: saved.id, version: draft!.version, values: readEventForm({ ...emptyEventForm(), title: "Nuit Parabole (exemple)", startsAt: "2026-06-27T22:00" }).values, status: "published" });
    expect(refused).toEqual({ ok: false, errors: { tags: "Choisis sa catégorie pour publier." } });

    const published = await saveForm(
      editor,
      { title: "Nuit Parabole (exemple)", startsAt: "2026-06-27T22:00", endsAt: "2026-06-28T05:00", venue: "La Goutte d'Or", tags: [fete], artists: [eloise] },
      { id: saved.id, version: draft!.version, status: "published" },
    );
    expect(published).toMatchObject({ ok: true });
    const online = await site().getEvent("nuit-parabole-exemple");
    expect(online).toMatchObject({ title: "Nuit Parabole (exemple)", venue: "La Goutte d'Or", tags: [{ slug: "fete", name: "Fête" }], artists: [{ name: "Éloïse Vachon (exemple)" }] });
  });

  it("refuse une adresse tapée déjà prise, et prévient quand quelqu'un a enregistré entre-temps", async () => {
    const taken = await saveForm(editor, { title: "Autre soirée", slug: "exemple-expo-sonore", startsAt: "2026-07-01T20:00" });
    expect(taken).toEqual({ ok: false, errors: { slug: "Cette adresse sert déjà à l'événement « Expo sonore (exemple) »." } });

    const id = await idOf(event, "exemple-talk-ecologie-sonore");
    const before = (await editor.getEvent(id))!;
    const fields = { title: before.title, startsAt: "2026-06-08T18:00", tags: [await idOf(tag, "rencontre-talk")] };
    expect(await saveForm(editor, fields, { id, version: before.version })).toMatchObject({ ok: true });
    const late = await saveForm(editor, fields, { id, version: before.version });
    expect(late).toMatchObject({ ok: false, version: expect.any(String), errors: { form: expect.stringContaining("pendant que tu le modifiais") } });
    if (late.ok || !("version" in late)) return;
    expect(await saveForm(editor, fields, { id, version: late.version })).toMatchObject({ ok: true });
  });

  it("met un visuel sur la fiche, que le site montre une fois l'événement publié", async () => {
    const id = await idOf(event, "exemple-rencontre-radios-de-quartier");
    const visual = await added({ alt: "Affiche de la rencontre", width: 1200, height: 1500 });
    const placed = await editor.placeMedia("visual", { id, mediaId: visual.id, version: (await editor.getEvent(id))!.version });
    expect(placed).toMatchObject({ ok: true, previous: null, version: expect.any(String) });
    expect((await editor.getEvent(id))!.visual).toMatchObject({ id: visual.id, alt: "Affiche de la rencontre" });
    expect((await site().getEvent("exemple-rencontre-radios-de-quartier"))!.visual).toMatchObject({ url: `${MEDIA_BASE}/${visual.key}`, width: 1200, height: 1500 });
    expect(await editor.placeMedia("visual", { id: "pas-un-id", mediaId: visual.id })).toMatchObject({ ok: false, errors: { form: expect.stringContaining("n'existe plus") } });
  });

  it("garde la galerie dans l'ordre choisi, avec ses légendes, et rend les photos retirées", async () => {
    const id = await idOf(event, "exemple-expo-sonore");
    const before = (await editor.getEvent(id))!.photos.map((photo) => photo.media.id);
    expect(before).toHaveLength(3);
    const [one, two] = [await added({ alt: "La file d'attente" }), await added({ alt: "Les platines" })];
    const grown = await editor.addEventPhotos(id, [
      { mediaId: one.id, caption: "À l'ouverture" },
      { mediaId: two.id, caption: null },
      { mediaId: one.id, caption: "En double" },
    ]);
    expect(grown).toMatchObject({ ok: true, released: [] });
    if (!grown.ok) return;
    // À la fin, une seule fois chacune.
    expect(grown.photos.map((photo) => photo.media.id)).toEqual([...before, one.id, two.id]);
    expect(grown.photos.slice(-2).map((photo) => photo.caption)).toEqual(["À l'ouverture", null]);

    const ordered = await editor.orderEventPhotos(id, [two.id, one.id]);
    expect(ordered.ok && ordered.photos.map((photo) => photo.media.id)).toEqual([two.id, one.id, ...before]);
    const captioned = await editor.captionEventPhoto(id, two.id, "Les platines, avant la fête");
    expect(captioned.ok && captioned.photos[0]!.caption).toBe("Les platines, avant la fête");

    // Le site les montre dans le même ordre, avec leur légende.
    const online = await site().getEvent("exemple-expo-sonore");
    expect(online!.photos.slice(0, 2).map((photo) => [photo.alt, photo.caption])).toEqual([
      ["Les platines", "Les platines, avant la fête"],
      ["La file d'attente", "À l'ouverture"],
    ]);

    // Une photo retirée de la galerie est rendue, puis effacée si elle ne sert plus nulle part.
    const removed = await editor.removeEventPhoto(id, one.id);
    expect(removed).toMatchObject({ ok: true, released: [one.id] });
    if (!removed.ok) return;
    expect(removed.photos.map((photo) => photo.media.id)).not.toContain(one.id);
    expect(await editor.releaseMedia(removed.released)).toEqual([one.key, ...one.variants.map((variant) => variant.key)]);
    expect(await connection.db.select({ id: media.id }).from(media).where(eq(media.id, one.id))).toEqual([]);
    // Une image encore dans la galerie n'est pas effacée.
    expect(await editor.releaseMedia([two.id])).toEqual([]);
  });

  it("supprime un événement et rend ses images, à effacer si elles ne servent plus", async () => {
    const saved = await saveForm(editor, { title: "Événement à supprimer", startsAt: "2026-07-14T21:00" });
    if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
    const [visual, photo] = [await added(), await added()];
    await editor.placeMedia("visual", { id: saved.id, mediaId: visual.id });
    await editor.addEventPhotos(saved.id, [{ mediaId: photo.id, caption: null }]);
    const removed = await editor.deleteEvent(saved.id);
    expect(removed).toEqual({ title: "Événement à supprimer", mediaIds: [visual.id, photo.id] });
    expect((await editor.releaseMedia(removed!.mediaIds)).length).toBe(4);
    expect(await editor.getEvent(saved.id)).toBeNull();
    expect(await editor.deleteEvent(saved.id)).toBeNull();
  });

  it("refuse toute écriture à un compte hors de l'équipe", async () => {
    const result = await saveForm(stranger, { title: "Intrus", startsAt: "2026-07-01T20:00" });
    expect(result).toEqual({ ok: false, errors: { form: expect.stringContaining("refuse") } });
    expect((await stranger.listEvents()).items.every((row) => row.status === "published")).toBe(true);
    const id = await idOf(event, "exemple-nuit-parabole");
    expect(await stranger.deleteEvent(id)).toBeNull();
    expect(await editor.getEvent(id)).not.toBeNull();
  });
});
