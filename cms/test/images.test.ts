/**
 * Les images (README, 9.3) : les seaux que crée la migration 0011_seaux.sql, le texte alternatif demandé à l'envoi,
 * puis, sous le rôle d'un éditeur, l'inscription d'une image envoyée, sa place sur une fiche (photo d'un artiste,
 * pochette d'un show), ce que le site en lit, et le retrait des images qui ne servent plus.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countExamples, ExampleUploadsError, removeExamples, seedExamples } from "../seed/exemples.ts";
import { createAdmin, readMediaText, type Admin, type MediaUpload } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { artist, event, eventPhoto, media, show } from "../src/schema.ts";
import { createAccount, exampleDb, MEDIA_BASE, NOW, rowsOf } from "./helpers.ts";

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
const idOf = async (table: typeof artist | typeof show, slug: string) => (await connection.db.select({ id: table.id }).from(table).where(eq(table.slug, slug)))[0]!.id;

let count = 0;
/** Une image telle que le site l'inscrit après l'envoi : sa plus grande version, et les plus petites. */
function upload(fields: Partial<MediaUpload> = {}): MediaUpload {
  const name = `images/2026/11/${String(++count).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return {
    key: `${name}-1600.webp`,
    sizeBytes: 182_000,
    width: 1600,
    height: 1600,
    alt: "Portrait en noir et blanc",
    credit: "© Photographe",
    variants: [
      { width: 400, key: `${name}-400.webp` },
      { width: 800, key: `${name}-800.webp` },
    ],
    ...fields,
  };
}

async function added(fields: Partial<MediaUpload> = {}) {
  const result = await editor.addMedia(upload(fields));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.media;
}

describe("les seaux du Storage", () => {
  it("sont créés par la migration : les originaux en privé, les versions du site en public, avec leurs limites", async () => {
    const buckets = rowsOf<{ id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      await connection.db.execute(sql`select id, public, file_size_limit::int, allowed_mime_types from storage.buckets order by id`),
    );
    expect(buckets).toEqual([
      { id: "media", public: true, file_size_limit: 5_000_000, allowed_mime_types: ["image/webp"] },
      { id: "originaux", public: false, file_size_limit: 25_000_000, allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "image/avif"] },
    ]);
  });
});

describe("le texte d'une image, vérifié", () => {
  it("demande un texte alternatif, sauf pour une image décorative", () => {
    expect(readMediaText({ alt: "  Éloïse   aux platines ", credit: " © Léa ", decorative: false })).toEqual({ values: { alt: "Éloïse aux platines", credit: "© Léa" }, errors: {} });
    expect(readMediaText({ alt: " ", credit: "", decorative: false }).errors).toEqual({ alt: expect.stringContaining("Image décorative") });
    expect(readMediaText({ alt: "oublié là", credit: "", decorative: true })).toEqual({ values: { alt: "", credit: null }, errors: {} });
  });

  it("garde des textes courts", () => {
    expect(readMediaText({ alt: "a".repeat(301), credit: "c".repeat(121), decorative: false }).errors).toEqual({ alt: expect.any(String), credit: expect.any(String) });
  });
});

describe("les images dans l'admin", () => {
  it("s'inscrivent pour l'équipe seulement, sans servir encore à rien", async () => {
    const file = await added();
    expect(file).toMatchObject({ key: expect.stringMatching(/^images\/2026\/11\/.+-1600\.webp$/), width: 1600, height: 1600, alt: "Portrait en noir et blanc" });
    expect(await editor.getMedia(file.id)).toEqual(file);
    expect(await stranger.getMedia(file.id)).toBeNull();
    expect(await stranger.addMedia(upload())).toEqual({ ok: false, errors: { form: expect.stringContaining("refuse") } });
  });

  it("refusent un fichier rangé ailleurs que dans les envois de l'admin", async () => {
    expect(await editor.addMedia(upload({ key: "exemples/intrus.webp" }))).toEqual({ ok: false, errors: { image: expect.any(String) } });
  });

  it("deviennent la photo d'un artiste, que le site montre en version réduite pour le srcset", async () => {
    const yaya = await idOf(artist, "exemple-yaya-kossi");
    const before = (await editor.getArtist(yaya))!;
    const file = await added({ credit: null });
    const placed = await editor.placeMedia("photo", { id: yaya, mediaId: file.id, version: before.version });
    expect(placed).toEqual({ ok: true, previous: null, version: expect.any(String) });
    const after = (await editor.getArtist(yaya))!;
    // L'écran avait la dernière version : il reçoit la nouvelle, et peut enregistrer le reste de la fiche sans alerte.
    expect(placed.ok && placed.version).toBe(after.version);
    expect(after.version).not.toBe(before.version);
    expect(after.photo).toEqual(file);

    const shown = (await site().getArtist("exemple-yaya-kossi"))!.photo!;
    const base = `${MEDIA_BASE}/${file.key.replace(/-1600\.webp$/, "")}`;
    expect(shown).toEqual({ url: `${base}-1600.webp`, width: 1600, height: 1600, alt: "Portrait en noir et blanc", credit: null, srcset: `${base}-400.webp 400w, ${base}-800.webp 800w, ${base}-1600.webp 1600w` });
    const card = (await site().listArtists({ role: "guest" })).groups.flatMap((group) => group.artists).find((one) => one.slug === "exemple-yaya-kossi");
    expect(card?.photo?.url).toBe(`${base}-1600.webp`);
  });

  it("remplacent une photo, et rendent l'ancienne ; une fiche modifiée entre-temps garde son alerte", async () => {
    const yaya = await idOf(artist, "exemple-yaya-kossi");
    const old = (await editor.getArtist(yaya))!;
    const file = await added();
    // L'écran n'a plus la dernière version : pas de nouveau jeton, son prochain enregistrement signalera le conflit.
    const placed = await editor.placeMedia("photo", { id: yaya, mediaId: file.id, version: "0" });
    expect(placed).toEqual({ ok: true, previous: old.photo!.id, version: null });
    // La même image une seconde fois : rien ne change.
    expect(await editor.placeMedia("photo", { id: yaya, mediaId: file.id })).toEqual({ ok: true, previous: null, version: null });
  });

  it("se retirent d'une fiche, et deviennent la pochette d'un show", async () => {
    const yaya = await idOf(artist, "exemple-yaya-kossi");
    const current = (await editor.getArtist(yaya))!;
    expect(await editor.placeMedia("photo", { id: yaya, mediaId: null, version: current.version })).toEqual({ ok: true, previous: current.photo!.id, version: expect.any(String) });
    expect((await editor.getArtist(yaya))!.photo).toBeNull();
    expect((await site().getArtist("exemple-yaya-kossi"))!.photo).toBeNull();

    const jazz = await idOf(show, "exemple-jazz-du-marche-dejean");
    const file = await added({ alt: "" });
    expect(await editor.placeMedia("cover", { id: jazz, mediaId: file.id })).toEqual({ ok: true, previous: null, version: null });
    expect((await editor.getShow(jazz))!.cover).toEqual(file);
  });

  it("refusent une image ou une fiche disparue, et un compte hors de l'équipe", async () => {
    const yaya = await idOf(artist, "exemple-yaya-kossi");
    expect(await editor.placeMedia("photo", { id: yaya, mediaId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, errors: { image: expect.any(String) } });
    const file = await added();
    expect(await editor.placeMedia("photo", { id: "00000000-0000-4000-8000-000000000000", mediaId: file.id })).toEqual({ ok: false, errors: { form: expect.stringContaining("artiste") } });
    expect(await editor.placeMedia("cover", { id: "pas-un-id", mediaId: file.id })).toEqual({ ok: false, errors: { form: expect.stringContaining("émission") } });
    // Hors de l'équipe, l'image n'existe pas pour lui.
    expect(await stranger.placeMedia("photo", { id: yaya, mediaId: file.id })).toEqual({ ok: false, errors: { image: expect.any(String) } });
  });

  it("changent de texte alternatif et de crédit", async () => {
    const file = await added();
    const described = await editor.describeMedia(file.id, { alt: "Deux platines et un micro", credit: null });
    expect(described).toEqual({ ok: true, media: { ...file, alt: "Deux platines et un micro", credit: null } });
    expect(await stranger.describeMedia(file.id, { alt: "Piraté", credit: null })).toEqual({ ok: false, errors: { image: expect.any(String) } });
    expect(await editor.describeMedia("00000000-0000-4000-8000-000000000000", { alt: "x", credit: null })).toMatchObject({ ok: false });
  });

  it("qui ne servent plus sont retirées, avec les clés de toutes leurs versions ; jamais celles qui servent, ni les exemples", async () => {
    const unused = await added();
    const used = await added();
    const bastien = await idOf(artist, "exemple-bastien-ocre");
    const example = (await editor.getArtist(bastien))!.photo!;
    await editor.placeMedia("photo", { id: bastien, mediaId: used.id });

    expect(await stranger.releaseMedia([unused.id])).toEqual([]);
    const keys = await editor.releaseMedia([unused.id, used.id, example.id, null, "pas-un-id", unused.id]);
    expect(keys).toEqual([unused.key, ...unused.variants.map((variant) => variant.key)]);
    expect(await editor.getMedia(unused.id)).toBeNull();
    expect(await editor.getMedia(used.id)).toEqual(used);
    // L'exemple ne sert plus (Bastien a une nouvelle photo), mais il n'a pas été envoyé depuis l'admin : il reste.
    expect(await editor.getMedia(example.id)).toEqual(example);
    expect(await editor.releaseMedia([])).toEqual([]);
  });

  it("d'un artiste supprimé est rendue par la suppression, puis retirée si rien d'autre ne s'en sert", async () => {
    const created = await editor.saveArtist({ values: { name: "Photo Seule", slug: "photo-seule", slugFromTitle: false, role: "guest", bio: null, links: [], tags: [] } });
    if (!created.ok) throw new Error(JSON.stringify(created.errors));
    const file = await added();
    await editor.placeMedia("photo", { id: created.id, mediaId: file.id });
    const removed = await editor.deleteArtist(created.id);
    expect(removed).toEqual({ name: "Photo Seule", photoId: file.id });
    expect(await editor.releaseMedia([removed!.photoId])).toHaveLength(3);
    expect(await connection.db.select({ id: media.id }).from(media).where(eq(media.id, file.id))).toEqual([]);
  });
});

// Sur une base à part : le retrait des exemples ne doit rien enlever aux tests précédents.
describe("le retrait des exemples", () => {
  let own: Connection;
  let team: Admin;
  let visual: string;
  let shot: string;

  beforeAll(async () => {
    own = await exampleDb();
    team = createAdmin(own.db, await createAccount(own.db, "editor"));
  });
  afterAll(() => own?.close());

  const ownId = async (table: typeof artist | typeof show | typeof event, slug: string) => (await own.db.select({ id: table.id }).from(table).where(eq(table.slug, slug)))[0]!.id;
  async function sent() {
    const result = await team.addMedia(upload());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.media.id;
  }
  const uploadsLeft = async () => rowsOf<{ n: number }>(await own.db.execute(sql`select count(*)::int as n from media where key like 'images/%'`))[0]!.n;

  it("s'arrête tant qu'une image envoyée depuis l'admin est posée sur un exemple, sans rien changer", async () => {
    await team.placeMedia("photo", { id: await ownId(artist, "exemple-bastien-ocre"), mediaId: await sent() });
    await team.placeMedia("photo", { id: await ownId(artist, "exemple-yaya-kossi"), mediaId: await sent() });
    await team.placeMedia("cover", { id: await ownId(show, "exemple-techno-de-minuit"), mediaId: await sent() });
    // Pas encore d'écran des événements : leur visuel et leur galerie se posent directement.
    visual = await sent();
    shot = await sent();
    await own.db.update(event).set({ visualId: visual }).where(eq(event.slug, "exemple-nuit-parabole"));
    await own.db.insert(eventPhoto).values({ eventId: await ownId(event, "exemple-expo-sonore"), mediaId: shot, position: 3 });
    const before = await countExamples(own.db);

    const refused = await removeExamples(own.db).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ExampleUploadsError);
    expect((refused as ExampleUploadsError).uploads).toEqual([
      { slot: "photo", name: "Bastien Ocre (exemple)" },
      { slot: "photo", name: "Yaya Kossi (exemple)" },
      { slot: "cover", name: "Techno de minuit (exemple)" },
      { slot: "visual", name: "Nuit Parabole (exemple)" },
      { slot: "gallery", name: "Expo sonore (exemple)" },
    ]);
    const message = (refused as Error).message;
    expect(message).toContain("Les exemples restent en place : 5 images envoyées depuis l'admin y sont posées.");
    expect(message).toContain("  - la photo de l'artiste « Bastien Ocre (exemple) »\n  - la photo de l'artiste « Yaya Kossi (exemple) »\n  - la pochette du show");
    expect(message).toContain("Depuis l'admin, retire chacune de ces images, ou supprime sa fiche. Puis relance la commande.");
    // Un jeu neuf commence par retirer l'ancien : arrêté de même.
    await expect(seedExamples(own.db, { now: NOW })).rejects.toThrow(ExampleUploadsError);
    expect(await countExamples(own.db)).toEqual(before);
    expect(await uploadsLeft()).toBe(5);
  });

  it("le dit au singulier pour une seule image", () => {
    expect(new ExampleUploadsError([{ slot: "photo", name: "Éloïse Vachon (exemple)" }]).message).toBe(
      [
        "Les exemples restent en place : une image envoyée depuis l'admin y est posée.",
        "  - la photo de l'artiste « Éloïse Vachon (exemple) »",
        "Retirer les exemples la laisserait sans fiche, avec ses fichiers dans le Storage : seul l'admin efface ces images.",
        "Depuis l'admin, retire cette image, ou supprime sa fiche. Puis relance la commande.",
        "Cette fiche n'est plus un exemple ? Change son adresse sur le site, qui commence par « exemple- » : la commande la laissera en place.",
      ].join("\n"),
    );
  });

  it("passe une fois ces images retirées depuis l'admin ; une fiche qui n'est plus un exemple reste, avec sa photo", async () => {
    // Bastien perd sa photo, le show est supprimé : l'admin rend leurs images, puis les retire.
    const unplaced = await team.placeMedia("photo", { id: await ownId(artist, "exemple-bastien-ocre"), mediaId: null });
    const deleted = await team.deleteShow(await ownId(show, "exemple-techno-de-minuit"));
    await own.db.update(event).set({ visualId: null }).where(eq(event.slug, "exemple-nuit-parabole"));
    await own.db.delete(eventPhoto).where(eq(eventPhoto.mediaId, shot));
    const ids = [unplaced.ok ? unplaced.previous : null, deleted?.coverId, visual, shot];
    expect(await team.releaseMedia(ids)).toHaveLength(12);
    // Yaya n'est plus un exemple : son adresse a changé.
    await own.db.update(artist).set({ slug: "yaya-kossi", name: "Yaya Kossi" }).where(eq(artist.slug, "exemple-yaya-kossi"));

    await removeExamples(own.db);
    expect(await countExamples(own.db)).toEqual({ shows: 0, artists: 0, events: 0, pages: 0, tags: 0, media: 0 });
    const [yaya] = await own.db.select({ photo: media.key }).from(artist).innerJoin(media, eq(media.id, artist.photoId)).where(eq(artist.slug, "yaya-kossi"));
    expect(yaya?.photo).toMatch(/^images\//);
    expect(await uploadsLeft()).toBe(1);
  });
});
