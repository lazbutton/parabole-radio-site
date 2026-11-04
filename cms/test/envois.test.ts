/**
 * Les envois des résidents (src/envois/, src/admin/envois.ts) : le calendrier des groupes, les fichiers acceptés, les
 * liens d'envoi et leurs règles d'accès, la page d'un lien (ouvrir, envoyer, corriger, mettre à jour sa fiche), le
 * rattachement des envois à leurs créneaux, ce que le tableau de bord en compte, et le ménage de la nuit.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin, emptyArtistForm, readArtistForm } from "../src/admin/index.ts";
import type { Connection, Db } from "../src/db.ts";
import { blockContaining, blockRange, dayLabel, deadlineAt, lateBlock, nextBlock, nextDeadline, proposedBlocks, type Cycle } from "../src/envois/calendrier.ts";
import { AUDIO_KEY, audioKey, audioRefusal, audioTypeOf, dispositionOf, trackFromFileName } from "../src/envois/fichiers.ts";
import { createEnvois, type EnvoiForm } from "../src/envois/index.ts";
import { rattacherEnvois } from "../src/envois/rattacher.ts";
import { artist, audioFile, broadcastCycle, show, showArtist, submission, tag, uploadLink } from "../src/schema.ts";
import { createAccount, freshDb, pgError } from "./helpers.ts";

const at = (iso: string) => new Date(iso);
const CYCLE: Cycle = { group1Start: "2026-12-14", blockDays: 14, deadlineDays: 15 };
/** Mardi 1er décembre 2026, 13 h à Paris : le groupe 2 est à l'antenne, sa deadline pour le 28 décembre tombe le 13. */
const DEC1 = at("2026-12-01T12:00:00Z");

describe("le calendrier des groupes", () => {
  it("alterne les blocs de deux semaines, chacun avec sa deadline le dimanche 15 jours avant", () => {
    expect(nextBlock(2, CYCLE, "2026-12-01")).toEqual({ group: 2, start: "2026-12-28", end: "2027-01-10", deadline: "2026-12-13" });
    expect(nextBlock(1, CYCLE, "2026-12-01")).toEqual({ group: 1, start: "2026-12-14", end: "2026-12-27", deadline: "2026-11-29" });
    expect(nextBlock(1, CYCLE, "2026-12-14")).toMatchObject({ start: "2027-01-11", deadline: "2026-12-27" });
    expect(blockContaining(2, CYCLE, "2026-12-05")).toMatchObject({ start: "2026-11-30", end: "2026-12-13" });
    expect(blockContaining(1, CYCLE, "2026-12-05")).toBeNull();
  });

  it("propose le prochain bloc, et après la deadline le même en retard avec le suivant", () => {
    // Dimanche 13 décembre, 23 h à Paris : encore à l'heure.
    expect(proposedBlocks(2, CYCLE, at("2026-12-13T22:00:00Z"))).toEqual([{ block: expect.objectContaining({ start: "2026-12-28" }), late: false }]);
    // Lundi 14, 0 h 30 : en retard pour le 28, à l'heure pour le 25 janvier.
    expect(proposedBlocks(2, CYCLE, at("2026-12-13T23:30:00Z"))).toEqual([
      { block: expect.objectContaining({ start: "2026-12-28" }), late: true },
      { block: expect.objectContaining({ start: "2027-01-25", deadline: "2027-01-10" }), late: false },
    ]);
  });

  it("trouve la prochaine deadline et le bloc des retardataires", () => {
    expect(nextDeadline(CYCLE, DEC1)).toMatchObject({ group: 2, deadline: "2026-12-13" });
    expect(lateBlock(CYCLE, DEC1)).toMatchObject({ group: 1, start: "2026-12-14" });
    expect(lateBlock(CYCLE, at("2026-12-08T12:00:00Z"))).toMatchObject({ group: 1 });
    // Un groupe est toujours entre sa deadline et son bloc : le 15, le groupe 2 (deadline le 13, bloc le 28).
    expect(lateBlock(CYCLE, at("2026-12-15T12:00:00Z"))).toMatchObject({ group: 2, start: "2026-12-28" });
  });

  it("compte à l'heure de Paris, changement d'heure compris", () => {
    expect(deadlineAt({ deadline: "2026-12-13" }).toISOString()).toBe("2026-12-13T22:59:59.000Z");
    // Le bloc du 22 mars 2027 passe à l'heure d'été le dimanche 28.
    const range = blockRange(nextBlock(2, CYCLE, "2027-03-20"));
    expect(range.from.toISOString()).toBe("2027-03-21T23:00:00.000Z");
    expect(range.to.toISOString()).toBe("2027-04-04T22:00:00.000Z");
    expect(blockRange({ start: "2026-12-28", end: "2027-01-10" }, 2).from.toISOString()).toBe("2027-01-03T23:00:00.000Z");
    expect(dayLabel("2026-12-13")).toBe("dimanche 13 déc.");
  });
});

describe("les fichiers son", () => {
  it("n'acceptent qu'un MP3 pour le son d'un show, les formats courants pour un morceau", () => {
    expect(audioTypeOf("Mon set.MP3", "main")).toEqual({ mime: "audio/mpeg", ext: "mp3" });
    expect(audioTypeOf("set.wav", "main")).toBeNull();
    expect(audioTypeOf("morceau.aif", "part")).toEqual({ mime: "audio/aiff", ext: "aiff" });
    expect(audioRefusal("set.wav", 10, "main")).toMatch(/MP3 320/);
    expect(audioRefusal("set.mp3", 800_000_000, "main")).toBe("Ce fichier dépasse 750 Mo.");
    expect(audioRefusal("set.mp3", 140_000_000, "main")).toBeNull();
  });

  it("rangent leur clé, gardent leur nom au téléchargement, et lisent l'artiste et le titre d'un nom de fichier", () => {
    expect(audioKey(randomUUID(), "mp3", DEC1)).toMatch(AUDIO_KEY);
    const disposition = dispositionOf("Été à Paris.mp3", true);
    expect(disposition).toMatch(/^attachment; filename="Ete a Paris\.mp3"; filename\*=UTF-8''%C3%89t%C3%A9%20%C3%A0%20Paris\.mp3$/);
    expect(trackFromFileName("03 - Daft Punk - One More Time.mp3")).toEqual({ artist: "Daft Punk", title: "One More Time" });
    expect(trackFromFileName("Intro.wav")).toEqual({ artist: "", title: "Intro" });
  });
});

describe("les envois des résidents", () => {
  let connection: Connection;
  let db: Db;
  let editor: ReturnType<typeof createAdmin>;
  let adminId: string;
  let stranger: string;
  let dj: { id: string };
  let other: { id: string };
  let house: { id: string };
  let token: string;
  let clock = DEC1;
  const envois = () => createEnvois(db, { now: () => clock });

  const form = (fields: Partial<EnvoiForm>): EnvoiForm => ({
    showId: "",
    version: "",
    type: "dj_set",
    blockStart: "2026-12-28",
    week: "",
    title: "Nuit club",
    description: "Deux heures de house.",
    energy: "4",
    tags: [],
    tracks: [],
    pasted: "",
    note: "",
    link: "",
    main: "",
    parts: [],
    cover: "",
    ...fields,
  });

  /** Un fichier préparé, puis « arrivé » dans le seau avec cette taille. */
  async function upload(role: "main" | "part", fileName: string, size = 1_000_000, showId?: string) {
    const ticket = await envois().preparerFichier(token, { role, fileName, size, showId });
    if (!ticket.ok) throw new Error(ticket.error);
    return { id: ticket.id, key: ticket.key, size };
  }

  /** Un créneau de la grille, tel que l'import Radio Cult le crée. */
  async function slot(title: string, broadcastAt: string, artistId: string) {
    const [row] = await db.insert(show).values({ slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 6)}`, title, type: "dj_set", broadcastAt: at(broadcastAt), durationSeconds: 7200, radiocultEventId: randomUUID() }).returning({ id: show.id });
    await db.insert(showArtist).values({ showId: row!.id, artistId, position: 0 });
    return row!.id;
  }

  beforeAll(async () => {
    connection = await freshDb();
    db = connection.db;
    editor = createAdmin(db, await createAccount(db, "editor"));
    adminId = await createAccount(db, "admin");
    stranger = await createAccount(db);
    dj = (await db.insert(artist).values({ name: "Secri", slug: "secri", role: "resident", broadcastGroup: 2, status: "published" }).returning({ id: artist.id }))[0]!;
    other = (await db.insert(artist).values({ name: "Autre", slug: "autre", role: "resident", broadcastGroup: 2 }).returning({ id: artist.id }))[0]!;
    house = (await db.insert(tag).values({ name: "House des envois", slug: "house-des-envois" }).returning({ id: tag.id }))[0]!;
  });
  afterAll(() => connection?.close());

  describe("les liens", () => {
    it("se créent, se renouvellent et se désactivent dans l'admin", async () => {
      const first = await editor.renewUploadLink(dj.id);
      expect(first?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const second = await editor.renewUploadLink(dj.id);
      expect(second?.token).not.toBe(first?.token);
      expect(await envois().ouvrir(first!.token)).toBeNull();
      expect(await editor.deleteUploadLink(dj.id)).toBe(true);
      expect(await editor.uploadLinkOf(dj.id)).toBeNull();
      token = (await editor.renewUploadLink(dj.id))!.token;
    });

    it("restent fermés au public et aux comptes hors de l'équipe", async () => {
      for (const table of [uploadLink, submission, audioFile, broadcastCycle]) {
        expect((await pgError(withViewer(db, { role: "anon" }, (tx) => tx.select().from(table)))).code).toBe("42501");
        expect(await withViewer(db, { role: "authenticated", userId: stranger }, (tx) => tx.select().from(table))).toEqual([]);
      }
    });
  });

  describe("la page d'un lien", () => {
    it("montre l'artiste, son prochain bloc et les étiquettes, et note l'ouverture", async () => {
      const page = await envois().ouvrir(token);
      expect(page?.artist).toMatchObject({ id: dj.id, name: "Secri", group: 2 });
      expect(page?.blocks).toEqual([{ block: expect.objectContaining({ start: "2026-12-28", deadline: "2026-12-13" }), late: false }]);
      expect(page?.items).toEqual([]);
      // Seulement les étiquettes rangées dans les filtres des shows : on coche, on ne tape pas.
      expect(page?.choices.facets.length).toBeGreaterThan(0);
      expect(page?.choices.tags.map((one) => one.name)).not.toContain("House des envois");
      const [link] = await db.select({ usedAt: uploadLink.usedAt }).from(uploadLink).where(eq(uploadLink.artistId, dj.id));
      expect(link?.usedAt?.toISOString()).toBe(DEC1.toISOString());
      expect(await envois().ouvrir("x".repeat(43))).toBeNull();
    });

    it("refuse un son qui n'est pas un MP3, et un show qui n'est pas à l'artiste", async () => {
      expect(await envois().preparerFichier(token, { role: "main", fileName: "set.wav", size: 10 })).toEqual({ ok: false, error: expect.stringMatching(/MP3 320/) });
      const foreign = await slot("Pas à lui", "2026-12-30T19:00:00Z", other.id);
      expect(await envois().preparerFichier(token, { role: "main", fileName: "set.mp3", size: 10, showId: foreign })).toMatchObject({ ok: false });
      const ok = await envois().preparerFichier(token, { role: "part", fileName: "piste.flac", size: 10 });
      expect(ok).toMatchObject({ ok: true, mime: "audio/flac", key: expect.stringMatching(/\.flac$/) });
    });
  });

  describe("un envoi", () => {
    let showId: string;
    let firstKey: string;

    it("crée un brouillon sans créneau, avec son envoi et son son", async () => {
      const main = await upload("main", "Nuit club.mp3", 140_000_000);
      firstKey = main.key;
      const done = await envois().deposer(token, form({ tags: [house.id], tracks: [{ start: "0:00", artist: "Kerri Chandler", title: "Rain", hopperUrl: "" }], note: "Merci !", main: main.id }), new Map([[main.id, main.size]]));
      expect(done).toMatchObject({ ok: true, removedKeys: [] });
      showId = (done as { showId: string }).showId;
      const [row] = await db.select({ status: show.status, title: show.title, broadcastAt: show.broadcastAt }).from(show).where(eq(show.id, showId));
      expect(row).toEqual({ status: "draft", title: "Nuit club", broadcastAt: null });
      const [sent] = await db.select().from(submission).where(eq(submission.showId, showId));
      expect(sent).toMatchObject({ artistId: dj.id, blockStart: "2026-12-28", note: "Merci !" });
      const [file] = await db.select().from(audioFile).where(eq(audioFile.id, main.id));
      expect(file).toMatchObject({ showId, status: "received", sizeBytes: 140_000_000 });
      const page = await envois().ouvrir(token);
      expect(page?.items).toEqual([expect.objectContaining({ showId, slot: false, envoi: expect.objectContaining({ blockStart: "2026-12-28", main: { fileName: "Nuit club.mp3", status: "received" } }) })]);
    });

    it("refuse un bloc qui n'est pas le sien, une étiquette inventée, un fichier pas arrivé", async () => {
      const main = await upload("main", "Autre.mp3");
      const refused = await envois().deposer(token, form({ blockStart: "2027-01-11", tags: ["nouveau:Truc", randomUUID()], main: main.id }), new Map());
      expect(refused).toMatchObject({ ok: false, errors: { blockStart: expect.any(String), tags: expect.any(String), main: expect.stringMatching(/pas arrivé/) } });
    });

    it("remplace le son, et rend la clé de l'ancien", async () => {
      const fiche = await envois().fiche(token, showId);
      expect(fiche).toMatchObject({ title: "Nuit club", tags: [house.id], note: "Merci !", main: { fileName: "Nuit club.mp3" } });
      const second = await upload("main", "Nuit club v2.mp3", 150_000_000, showId);
      const done = await envois().deposer(token, form({ showId, version: fiche!.version, tags: fiche!.tags, main: second.id }), new Map([[second.id, second.size]]));
      expect(done).toMatchObject({ ok: true, removedKeys: [firstKey] });
      const mains = await db.select({ id: audioFile.id }).from(audioFile).where(sql`${audioFile.showId} = ${showId} and ${audioFile.role} = 'main'`);
      expect(mains).toEqual([{ id: second.id }]);
    });

    it("signale une fiche modifiée entre-temps par l'équipe", async () => {
      const fiche = await envois().fiche(token, showId);
      await db.update(show).set({ description: "Corrigé par l'équipe." }).where(eq(show.id, showId));
      const late = await envois().deposer(token, form({ showId, version: fiche!.version, title: "Nuit club, encore" }), new Map());
      expect(late).toMatchObject({ ok: false, version: expect.any(String) });
    });

    it("ne touche plus à une émission partie sur SoundCloud", async () => {
      await db.update(audioFile).set({ status: "sent" }).where(sql`${audioFile.showId} = ${showId} and ${audioFile.role} = 'main'`);
      expect(await envois().fiche(token, showId)).toBeNull();
      expect(await envois().deposer(token, form({ showId }), new Map())).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/plus modifiable/) } });
      await db.update(audioFile).set({ status: "received" }).where(sql`${audioFile.showId} = ${showId} and ${audioFile.role} = 'main'`);
    });

    it("d'une playlist : des morceaux dans l'ordre, ou au moins un lien", async () => {
      expect(await envois().deposer(token, form({ type: "playlist", title: "Sélection" }), new Map())).toMatchObject({ ok: false, errors: { parts: expect.any(String) } });
      const withLink = await envois().deposer(token, form({ type: "playlist", title: "Sélection", link: "https://www.deezer.com/fr/playlist/123" }), new Map());
      expect(withLink).toMatchObject({ ok: true });
      const one = await upload("part", "01 - A - Un.mp3");
      const two = await upload("part", "02 - B - Deux.flac");
      const parts = [
        { id: one.id, artist: "A", title: "Un", duration: "200" },
        { id: two.id, artist: "B", title: "Deux", duration: "180" },
      ];
      const done = await envois().deposer(token, form({ type: "playlist", title: "Sélection 2", parts }), new Map([[one.id, one.size], [two.id, two.size]]));
      const playlist = (done as { showId: string }).showId;
      const fiche = await envois().fiche(token, playlist);
      expect(fiche?.parts.map((part) => [part.position, part.artist, part.title, part.durationSeconds])).toEqual([
        [1, "A", "Un", 200],
        [2, "B", "Deux", 180],
      ]);
      const again = await envois().deposer(token, form({ showId: playlist, version: fiche!.version, type: "playlist", title: "Sélection 2", parts: [parts[1]!] }), new Map());
      expect(again).toMatchObject({ ok: true, removedKeys: [one.key] });
      expect((await envois().fiche(token, playlist))?.parts.map((part) => part.position)).toEqual([1]);
    });
  });

  describe("la pochette d'un envoi", () => {
    it("se pose avec l'émission, se remplace, se retire, et libère l'ancienne", async () => {
      const image = (id: string) => ({ key: `images/2026/12/${id}-800.webp`, sizeBytes: 1000, width: 800, height: 800, variants: [{ width: 400, key: `images/2026/12/${id}-400.webp` }], alt: "Pochette", credit: null });
      const main = await upload("main", "Pochette.mp3");
      const created = await envois().deposer(token, form({ title: "Avec pochette", main: main.id }), new Map([[main.id, main.size]]));
      const showId = (created as { showId: string }).showId;
      const coverOf = async () => (await db.select({ coverId: show.coverId }).from(show).where(eq(show.id, showId)))[0]?.coverId;
      const version = async () => (await envois().fiche(token, showId))!.version;

      const first = ((await envois().ajouterImage(token, image(randomUUID()))) as { media: { id: string } }).media.id;
      expect(await envois().deposer(token, form({ showId, version: await version(), title: "Avec pochette", cover: first }), new Map())).toMatchObject({ ok: true, removedImages: [] });
      expect(await coverOf()).toBe(first);

      const second = ((await envois().ajouterImage(token, image(randomUUID()))) as { media: { id: string } }).media.id;
      const swapped = await envois().deposer(token, form({ showId, version: await version(), title: "Avec pochette", cover: second }), new Map());
      expect((swapped as { removedImages: string[] }).removedImages).toHaveLength(2);
      expect(await coverOf()).toBe(second);

      const removed = await envois().deposer(token, form({ showId, version: await version(), title: "Avec pochette", cover: "none" }), new Map());
      expect((removed as { removedImages: string[] }).removedImages).toHaveLength(2);
      expect(await coverOf()).toBeNull();
      expect(await envois().deposer(token, form({ showId, version: await version(), cover: "pas-une-image" }), new Map())).toMatchObject({ ok: false, errors: { cover: expect.any(String) } });
      // Un envoi de plus dans le bloc rendrait les rattachements ci-dessous ambigus.
      await db.delete(show).where(eq(show.id, showId));
    });
  });

  describe("la fiche de l'artiste", () => {
    it("prend sa bio et sa photo, et note la mise à jour", async () => {
      const image = (id: string) => ({ key: `images/2026/12/${id}-800.webp`, sizeBytes: 1000, width: 800, height: 800, variants: [{ width: 400, key: `images/2026/12/${id}-400.webp` }], alt: "Portrait", credit: null });
      const first = await envois().ajouterImage(token, image(randomUUID()));
      const second = await envois().ajouterImage(token, image(randomUUID()));
      expect(await envois().majFiche(token, { bio: "DJ du 18e.", photo: (first as { media: { id: string } }).media.id })).toEqual({ ok: true, removedImages: [] });
      const swapped = await envois().majFiche(token, { photo: (second as { media: { id: string } }).media.id });
      expect((swapped as { removedImages: string[] }).removedImages).toHaveLength(2);
      const [row] = await db.select({ bio: artist.bio, photoId: artist.photoId }).from(artist).where(eq(artist.id, dj.id));
      expect(row).toEqual({ bio: "DJ du 18e.", photoId: (second as { media: { id: string } }).media.id });
      const [link] = await db.select({ at: uploadLink.profileUpdatedAt }).from(uploadLink).where(eq(uploadLink.artistId, dj.id));
      expect(link?.at).toBeInstanceOf(Date);
    });

    it("garde le groupe de diffusion d'un résident, et refuse un groupe qui n'existe pas", () => {
      expect(readArtistForm({ ...emptyArtistForm(), name: "X", broadcastGroup: "3" }).errors.broadcastGroup).toBeDefined();
      expect(readArtistForm({ ...emptyArtistForm(), name: "X", broadcastGroup: "2" }).values.broadcastGroup).toBe(2);
      expect(readArtistForm({ ...emptyArtistForm(), name: "X", broadcastGroup: "" }).values.broadcastGroup).toBeNull();
      expect("broadcastGroup" in readArtistForm({ ...emptyArtistForm(), name: "X" }).values).toBe(false);
    });
  });

  describe("le rattachement aux créneaux", () => {
    it("rattache seul l'envoi qui n'a qu'un créneau possible, en gardant la date et le créneau", async () => {
      // Les playlists envoyées plus haut visent le même bloc : on les retire, pour qu'un seul envoi reste en lice.
      await db.delete(show).where(sql`${show.title} like 'Sélection%'`);
      const [pending] = await db.select({ showId: submission.showId }).from(submission).innerJoin(show, eq(show.id, submission.showId)).where(eq(show.title, "Nuit club"));
      const target = await slot("Secri x Parabole", "2026-12-29T19:00:00Z", dj.id);
      const result = await rattacherEnvois(db, { now: DEC1 });
      expect(result.attached).toContainEqual({ from: pending!.showId, to: target });
      const [row] = await db.select({ title: show.title, broadcastAt: show.broadcastAt, slot: show.radiocultEventId, description: show.description }).from(show).where(eq(show.id, target));
      expect(row).toMatchObject({ title: "Nuit club", broadcastAt: at("2026-12-29T19:00:00Z"), description: "Corrigé par l'équipe." });
      expect(row?.slot).not.toBeNull();
      expect(await db.select().from(show).where(eq(show.id, pending!.showId))).toEqual([]);
      expect(await db.select({ id: submission.showId }).from(submission).where(eq(submission.showId, target))).toHaveLength(1);
      expect((await editor.audioFilesOf(target)).map((file) => file.fileName)).toEqual(["Nuit club v2.mp3"]);
    });

    it("laisse à l'équipe deux envois et deux créneaux, sauf si la semaine les départage", async () => {
      const a = await envois().deposer(token, form({ title: "Épisode A", main: (await uploadFor("A")).id }), arrivedLast);
      const b = await envois().deposer(token, form({ title: "Épisode B", main: (await uploadFor("B")).id }), arrivedLast);
      const first = await slot("Créneau 1", "2026-12-30T19:00:00Z", dj.id);
      const second = await slot("Créneau 2", "2027-01-06T19:00:00Z", dj.id);
      expect((await rattacherEnvois(db, { now: DEC1 })).attached).toEqual([]);
      expect(await editor.attachCandidates((a as { showId: string }).showId, { now: DEC1 })).toHaveLength(2);
      await db.update(submission).set({ week: 1 }).where(eq(submission.showId, (a as { showId: string }).showId));
      await db.update(submission).set({ week: 2 }).where(eq(submission.showId, (b as { showId: string }).showId));
      const result = await rattacherEnvois(db, { now: DEC1 });
      expect(result.attached).toEqual(expect.arrayContaining([{ from: (a as { showId: string }).showId, to: first }, { from: (b as { showId: string }).showId, to: second }]));
      expect(result.left).toBe(0);
    });

    it("se fait à la main dans l'admin, et refuse un créneau qui a déjà son émission", async () => {
      const c = await envois().deposer(token, form({ title: "Épisode C", main: (await uploadFor("C")).id }), arrivedLast);
      const taken = (await db.select({ id: submission.showId }).from(submission).innerJoin(show, eq(show.id, submission.showId)).where(eq(show.title, "Épisode A")))[0]!.id;
      expect(await editor.attachSubmission((c as { showId: string }).showId, taken)).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/déjà son émission/) } });
      const free = await slot("Créneau 3", "2027-01-08T19:00:00Z", dj.id);
      expect(await editor.attachSubmission((c as { showId: string }).showId, free)).toMatchObject({ ok: true, id: free });
    });

    let arrivedLast = new Map<string, number>();
    async function uploadFor(name: string) {
      const file = await upload("main", `${name}.mp3`);
      arrivedLast = new Map([[file.id, file.size]]);
      return file;
    }
  });

  describe("le tableau de bord", () => {
    it("compte les sons à écouter, refusés, les playlists à assembler, les envois sans créneau, comme les listes", async () => {
      await envois().deposer(token, form({ type: "playlist", title: "À assembler", link: "https://www.deezer.com/fr/playlist/456" }), new Map());
      const before = await editor.overview({ now: DEC1 });
      for (const missing of ["review", "failed", "assemble", "slot"] as const) {
        expect((await editor.listShows({ missing, now: DEC1 })).total).toBe(before.envois[missing]);
      }
      expect(before.envois.assemble).toBeGreaterThan(0);
      const [first] = (await editor.listShows({ missing: "review", now: DEC1 })).items;
      const [file] = (await editor.audioFilesOf(first!.id)).filter((one) => one.role === "main");
      expect(await editor.approveAudio(file!.id)).toBe(true);
      expect((await editor.overview({ now: DEC1 })).envois.review).toBe(before.envois.review - 1);
    });

    it("montre les deadlines : les retardataires du bloc qui va commencer, puis la prochaine, avec les liens pour relancer", async () => {
      const { deadlines } = await editor.overview({ now: DEC1 });
      expect(deadlines.map((panel) => [panel.block.group, panel.block.start, panel.late])).toEqual([
        [1, "2026-12-14", true],
        [2, "2026-12-28", false],
      ]);
      expect(deadlines[1]!.residents).toEqual([
        { id: other.id, name: "Autre", sent: false, token: null },
        { id: dj.id, name: "Secri", sent: true, token },
      ]);
    });

    it("ne laisse régler le calendrier qu'à un admin", async () => {
      const values = { group1Start: "2026-12-14", blockDays: 14, deadlineDays: 15 };
      expect(await editor.saveCycle(values)).toMatchObject({ ok: false, errors: { form: expect.any(String) } });
      expect(await editor.saveCycle({ ...values, group1Start: "2026-12-15" })).toMatchObject({ ok: false, errors: { group1Start: "Choisis un lundi." } });
      expect(await createAdmin(db, adminId).saveCycle(values)).toEqual({ ok: true });
    });
  });

  describe("le ménage de la nuit", () => {
    it("oublie les fichiers jamais arrivés, et passe en échec un envoi vers SoundCloud bloqué", async () => {
      const lost = await upload("main", "Perdu.mp3");
      await db.update(audioFile).set({ createdAt: at("2026-11-29T12:00:00Z") }).where(eq(audioFile.id, lost.id));
      const [stuck] = await db.select({ id: audioFile.id }).from(audioFile).where(sql`${audioFile.role} = 'main' and ${audioFile.status} <> 'uploading'`).limit(1);
      await db.execute(sql`update audio_file set status = 'sending' where id = ${stuck!.id}`);
      await db.execute(sql`alter table audio_file disable trigger touch_updated_at`);
      await db.execute(sql`update audio_file set updated_at = ${at("2026-12-01T11:00:00Z").toISOString()}::timestamptz where id = ${stuck!.id}`);
      await db.execute(sql`alter table audio_file enable trigger touch_updated_at`);
      const result = await envois().menage();
      expect(result.keys).toContain(lost.key);
      expect(result.stuck).toBe(1);
      const [row] = await db.select({ status: audioFile.status, error: audioFile.error }).from(audioFile).where(eq(audioFile.id, stuck!.id));
      expect(row).toMatchObject({ status: "failed", error: expect.stringMatching(/Publier maintenant/) });
    });
  });
});
