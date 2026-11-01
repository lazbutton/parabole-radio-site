/**
 * Les vidéos de fond (drizzle/0004_fond.sql, 0005_fond_acces.sql) : les clips d'origine posés par la migration, la
 * liste que lit le site, les règles d'accès, et les écritures de l'admin (ajout, titre, rotation, ordre, remplacement
 * du fichier, suppression).
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin, readClipFile, readClipTitle, type Admin, type ClipFileForm } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { backgroundClip } from "../src/schema.ts";
import { createAccount, exampleDb, MEDIA_BASE, pgError } from "./helpers.ts";

const ORIGIN = "/PARABOLE RADIO/VIDEO/BACKGROUND";
const BLOB = "https://exemple.public.blob.vercel-storage.com/fond";

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

/** Le fichier d'un clip tel que l'écran l'envoie après l'envoi sur Vercel Blob. */
const fileForm = (name: string, fields: Partial<ClipFileForm> = {}): ClipFileForm => ({
  videoUrl: `${BLOB}/${name}.mp4`,
  posterUrl: `${BLOB}/${name}.jpg`,
  mimeType: "video/mp4",
  size: "3500000",
  duration: "61.4",
  width: "640",
  height: "360",
  ...fields,
});

/** Ajoute un clip saisi comme à l'écran ; l'échec d'un test qui l'attend réussi se lit tout de suite. */
async function add(name: string, title = name, status: "published" | "draft" = "published") {
  const { values, errors } = readClipFile(fileForm(name));
  expect(errors).toEqual({});
  const added = await editor.addClip({ title, file: values, status });
  if (!added.ok) throw new Error(JSON.stringify(added.errors));
  return added.id;
}

describe("les clips d'origine", () => {
  it("sont posés par la migration, dans la rotation, dans l'ordre de l'ancienne liste, avec leur image d'attente", async () => {
    const clips = await site().listBackgroundClips();
    expect(clips).toHaveLength(15);
    expect(clips[0]).toEqual({ src: `${ORIGIN}/background.mp4`, title: "Baile Furacão 2000", poster: `${ORIGIN}/background.jpg` });
    expect(clips[3]).toMatchObject({ src: `${ORIGIN}/background4.mp4`, title: "Kiss FM Paris (INA)" });
    expect(clips[14]).toEqual({ src: `${ORIGIN}/background15.mp4`, title: "", poster: `${ORIGIN}/background15.jpg` });
  });
});

describe("le fichier d'un clip, vérifié", () => {
  it("garde les adresses https et les chemins du site, et arrondit ce que le navigateur a lu", () => {
    const { values, errors } = readClipFile(fileForm("a", { duration: "61.4", size: "3500000.0" }));
    expect(errors).toEqual({});
    expect(values).toEqual({ videoUrl: `${BLOB}/a.mp4`, posterUrl: `${BLOB}/a.jpg`, mimeType: "video/mp4", sizeBytes: 3500000, durationSeconds: 61, width: 640, height: 360 });
    expect(readClipFile(fileForm("b", { videoUrl: `${ORIGIN}/background2.mp4`, posterUrl: "" })).values).toMatchObject({ videoUrl: `${ORIGIN}/background2.mp4`, posterUrl: null });
  });

  it("refuse une adresse d'un autre genre, et un type qui n'est pas une vidéo du web", () => {
    for (const videoUrl of ["", "http://exemple.fr/a.mp4", "//exemple.fr/a.mp4", "javascript:alert(1)", "fond/a.mp4"])
      expect(readClipFile(fileForm("c", { videoUrl })).errors, videoUrl).toEqual({ video: expect.any(String) });
    expect(readClipFile(fileForm("c", { posterUrl: "data:image/jpeg;base64,AAAA" })).errors).toEqual({ video: expect.any(String) });
    expect(readClipFile(fileForm("c", { mimeType: "video/quicktime" })).errors).toEqual({ video: "Une vidéo MP4 ou WebM seulement." });
  });

  it("oublie des dimensions incomplètes ou absurdes, et une durée nulle", () => {
    expect(readClipFile(fileForm("d", { width: "640", height: "" })).values).toMatchObject({ width: null, height: null });
    expect(readClipFile(fileForm("d", { width: "-3", height: "360" })).values).toMatchObject({ width: null, height: null });
    expect(readClipFile(fileForm("d", { duration: "0", size: "abc" })).values).toMatchObject({ durationSeconds: null, sizeBytes: null });
    expect(readClipFile(fileForm("d", { duration: "0.2" })).values.durationSeconds).toBe(1);
  });

  it("remet un titre sur une ligne, vide permis", () => {
    expect(readClipTitle("  Kiss FM\n Paris  ")).toEqual({ title: "Kiss FM Paris", errors: {} });
    expect(readClipTitle("")).toEqual({ title: "", errors: {} });
    expect(readClipTitle("x".repeat(201)).errors).toEqual({ title: "200 caractères au plus." });
  });
});

describe("les règles d'accès des clips", () => {
  it("montrent au public la rotation seulement, et lui refusent toute écriture", async () => {
    const hidden = await add("cache", "Mis de côté", "draft");
    const seen = await withViewer(connection.db, { role: "anon" }, (tx) => tx.select({ id: backgroundClip.id }).from(backgroundClip));
    expect(seen.map((row) => row.id)).not.toContain(hidden);
    expect(seen).toHaveLength((await site().listBackgroundClips()).length);
    const insert = await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.insert(backgroundClip).values({ videoUrl: "/intrus.mp4", position: 99 })));
    expect(insert.code).toBe("42501");
    const truncate = await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.execute(sql`truncate background_clip`)));
    expect(truncate.code).toBe("42501");
    await editor.deleteClip(hidden);
  });

  it("ne laissent rien écrire à un compte hors de l'équipe", async () => {
    const [first] = await editor.listClips();
    expect(await stranger.updateClip(first!.id, { title: "Piraté" })).toEqual({ ok: false, errors: { form: expect.any(String) } });
    expect(await stranger.deleteClip(first!.id)).toBeNull();
    expect((await stranger.listClips()).map((clip) => clip.status)).not.toContain("draft");
    const { values } = readClipFile(fileForm("intrus"));
    expect(await stranger.addClip({ title: "Intrus", file: values, status: "published" })).toEqual({ ok: false, errors: { form: expect.stringContaining("refuse") } });
    expect((await editor.getClip(first!.id))?.title).toBe(first!.title);
  });
});

describe("les clips dans l'admin", () => {
  it("ajoutent une vidéo à la fin de la liste, dans la rotation ou de côté", async () => {
    const before = await editor.listClips();
    const id = await add("nouveau", "Nouveau clip");
    const draft = await add("brouillon", "Pas encore", "draft");
    const after = await editor.listClips();
    expect(after.map((clip) => clip.id).slice(-2)).toEqual([id, draft]);
    expect(after.at(-2)).toMatchObject({ title: "Nouveau clip", status: "published", sizeBytes: 3500000, durationSeconds: 61, width: 640, height: 360, position: before.length + 1 });
    const rotation = await site().listBackgroundClips();
    expect(rotation.at(-1)).toEqual({ src: `${BLOB}/nouveau.mp4`, title: "Nouveau clip", poster: `${BLOB}/nouveau.jpg` });
    expect(rotation.map((clip) => clip.title)).not.toContain("Pas encore");
    await editor.deleteClip(id);
    await editor.deleteClip(draft);
  });

  it("refusent deux fois le même fichier", async () => {
    const id = await add("double");
    const { values } = readClipFile(fileForm("double"));
    expect(await editor.addClip({ title: "Encore", file: values, status: "published" })).toEqual({ ok: false, errors: { video: "Cette vidéo est déjà dans la liste." } });
    await editor.deleteClip(id);
  });

  it("changent le titre, et mettent un clip de côté puis le remettent dans la rotation", async () => {
    const [first] = await editor.listClips();
    expect(await editor.updateClip(first!.id, { title: "Baile Furacão" })).toEqual({ ok: true, id: first!.id });
    expect((await site().listBackgroundClips())[0]!.title).toBe("Baile Furacão");
    await editor.updateClip(first!.id, { status: "draft" });
    expect((await site().listBackgroundClips()).map((clip) => clip.src)).not.toContain(first!.videoUrl);
    await editor.updateClip(first!.id, { status: "published", title: first!.title });
    expect((await site().listBackgroundClips())[0]).toMatchObject({ src: first!.videoUrl, title: "Baile Furacão 2000" });
    expect(await editor.updateClip("00000000-0000-4000-8000-000000000000", { title: "x" })).toEqual({ ok: false, errors: { form: expect.any(String) } });
  });

  it("déplacent un clip d'une place et renumérotent la liste", async () => {
    const id = await add("deplace");
    const hole = await add("trou");
    await editor.deleteClip(hole);
    const before = (await editor.listClips()).map((clip) => clip.id);
    expect(await editor.moveClip(id, "up")).toBe(true);
    const after = await editor.listClips();
    expect(after.map((clip) => clip.id)).toEqual([...before.slice(0, -2), id, before.at(-2)!]);
    expect(after.map((clip) => clip.position)).toEqual(after.map((_, index) => index + 1));
    // En tête, monter ne change rien ; un clip disparu non plus.
    const top = after[0]!.id;
    expect(await editor.moveClip(top, "up")).toBe(true);
    expect((await editor.listClips())[0]!.id).toBe(top);
    expect(await editor.moveClip("00000000-0000-4000-8000-000000000000", "down")).toBe(false);
    await editor.moveClip(id, "down");
    expect((await editor.listClips()).at(-1)!.id).toBe(id);
    await editor.deleteClip(id);
  });

  it("remplacent le fichier d'un clip, qui garde sa place, son titre et son statut, et rendent l'ancien", async () => {
    const id = await add("avant", "Même place");
    const { values } = readClipFile(fileForm("apres", { mimeType: "video/webm", videoUrl: `${BLOB}/apres.webm`, duration: "12" }));
    const replaced = await editor.replaceClipFile(id, values);
    expect(replaced).toEqual({ ok: true, id, previous: { title: "Même place", videoUrl: `${BLOB}/avant.mp4`, posterUrl: `${BLOB}/avant.jpg` } });
    expect(await editor.getClip(id)).toMatchObject({ title: "Même place", videoUrl: `${BLOB}/apres.webm`, mimeType: "video/webm", durationSeconds: 12, status: "published" });
    expect(await editor.replaceClipFile("00000000-0000-4000-8000-000000000000", values)).toMatchObject({ ok: false });
    await editor.deleteClip(id);
  });

  it("suppriment un clip et rendent ses fichiers, à effacer du stockage", async () => {
    const id = await add("adieu", "Adieu");
    expect(await editor.deleteClip(id)).toEqual({ title: "Adieu", videoUrl: `${BLOB}/adieu.mp4`, posterUrl: `${BLOB}/adieu.jpg` });
    expect(await editor.getClip(id)).toBeNull();
    expect(await editor.deleteClip(id)).toBeNull();
  });
});
