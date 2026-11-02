/**
 * Les images (README, 9.3) : les seaux que crée la migration 0011_seaux.sql, le texte alternatif demandé à l'envoi,
 * puis, sous le rôle d'un éditeur, l'inscription d'une image envoyée, sa place sur une fiche (photo d'un artiste,
 * pochette d'un show), ce que le site en lit, et le retrait des images qui ne servent plus.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, readMediaText, type Admin, type MediaUpload } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { artist, media, show } from "../src/schema.ts";
import { createAccount, exampleDb, MEDIA_BASE, rowsOf } from "./helpers.ts";

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
    expect(await editor.placeMedia("cover", { id: "pas-un-id", mediaId: file.id })).toEqual({ ok: false, errors: { form: expect.stringContaining("show") } });
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
