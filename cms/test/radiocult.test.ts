/**
 * L'import de la programmation Radio Cult (src/radiocult/) : les réponses de l'API traduites, puis l'import lui-même,
 * par la tâche de nuit (connexion du serveur) et par le bouton de l'accueil (sous le rôle d'un membre), son journal et
 * ce que l'accueil en relit.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdmin, emptyArtistForm, readArtistForm } from "../src/admin/index.ts";
import type { Connection, Db } from "../src/db.ts";
import { importRadioCult, importStatus, markdownFrom, slotsFromRadioCult, type ImportInput, type RadioCultSlot } from "../src/radiocult/index.ts";
import { linksFrom, showTypeOf } from "../src/radiocult/traduction.ts";
import { artist, radiocultImport, show, showArtist } from "../src/schema.ts";
import { createAccount, freshDb, NOW, pgError } from "./helpers.ts";

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

/** Un créneau tel que le rend /schedule. */
const raw = (fields: Record<string, unknown>) => ({ isRecurring: false, media: { type: "mix" }, ...fields });

describe("les réponses de Radio Cult, traduites", () => {
  it("gardent un créneau seul sous son identifiant, une occurrence répétée sous sa série et son jour à Paris", () => {
    const [alone, repeated, broken] = slotsFromRadioCult([
      raw({ id: "a1", originalId: "a1", title: "  FREE LES ROBOTS ", startDateUtc: "2026-06-16T15:30:00.000Z", endDateUtc: "2026-06-16T16:30:00.000Z" }),
      // 22 h 30 en heure universelle, le 16 : déjà le 17 à Paris.
      raw({ id: "s1-r_index-2026-06-16T22:30:00.000Z", originalId: "s1", isRecurring: true, title: "Nuit", startDateUtc: "2026-06-16T22:30:00.000Z", endDateUtc: "2026-06-17T00:30:00.000Z" }),
      raw({ id: "b1", title: "Sans fin", startDateUtc: "2026-06-16T15:30:00.000Z", endDateUtc: "2026-06-16T15:30:00.000Z" }),
    ]);
    expect(alone).toMatchObject({ key: "a1", series: null, title: "FREE LES ROBOTS", media: "mix", artists: [] });
    expect(repeated).toMatchObject({ key: "s1@2026-06-17", series: "s1" });
    expect(broken).toBeUndefined();
  });

  it("donnent à un créneau ses artistes, de la réponse elle-même ou de la liste, sans doublon", () => {
    const artists = [
      { id: "r1", name: "Secri", socials: {} },
      { id: "r2", name: "CHICA SUPER!", slug: "chica-super", socials: { instagramHandle: "chica" } },
    ];
    const [fromList, expanded] = slotsFromRadioCult(
      [
        raw({ id: "a1", title: "Un", startDateUtc: "2026-06-16T15:00:00Z", endDateUtc: "2026-06-16T16:00:00Z", artistIds: ["r2", "inconnu", "r1", "r2"] }),
        raw({ id: "a2", title: "Deux", startDateUtc: "2026-06-17T15:00:00Z", endDateUtc: "2026-06-17T16:00:00Z", artistIds: ["r1"], artists: [{ id: "r1", name: "Secri (à jour)" }] }),
      ],
      artists,
    );
    expect(fromList!.artists.map((one) => one.name)).toEqual(["CHICA SUPER!", "Secri"]);
    expect(fromList!.artists[0]!.links).toEqual([{ label: "Instagram", url: "https://www.instagram.com/chica/" }]);
    expect(expanded!.artists.map((one) => one.name)).toEqual(["Secri (à jour)"]);
  });

  it("lisent une description TipTap en Markdown, sans HTML ni liens douteux", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Ce soir" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Avec " },
            { type: "text", text: "Secri ", marks: [{ type: "bold" }] },
            { type: "text", text: "et ses *amis*", marks: [{ type: "italic" }] },
            { type: "hardBreak" },
            { type: "text", text: "écoute", marks: [{ type: "link", attrs: { href: "https://soundcloud.com/secri" } }] },
            { type: "text", text: " ou pas", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: " <b>" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "1. pas une liste" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "house" }] }] }] },
        { type: "paragraph" },
      ],
    };
    expect(markdownFrom(doc)).toBe(
      ["## Ce soir", "Avec **Secri** *et ses \\*amis\\**\\\n[écoute](https://soundcloud.com/secri) ou pas \\<b\\>", "1\\. pas une liste", "- house"].join("\n\n"),
    );
    expect(markdownFrom({ type: "doc", content: [{ type: "paragraph" }] })).toBeNull();
    expect(markdownFrom(undefined)).toBeNull();
  });

  it("font des réseaux d'un artiste des liens de fiche, sans adresse douteuse", () => {
    expect(
      linksFrom({
        instagramHandle: "@chris.rayan",
        twitterHandle: "https://x.com/secri",
        soundcloud: "https://soundcloud.com/secriyanra",
        site: "secri.fr",
        facebook: "javascript:alert(1)",
        mixcloud: "pas une adresse",
      }),
    ).toEqual([
      { label: "SoundCloud", url: "https://soundcloud.com/secriyanra" },
      { label: "Instagram", url: "https://www.instagram.com/chris.rayan/" },
      { label: "Site", url: "https://secri.fr/" },
      { label: "X", url: "https://x.com/secri" },
    ]);
    expect(linksFrom(undefined)).toEqual([]);
  });

  it("tirent le type du show du créneau", () => {
    expect(showTypeOf({ title: "Club", media: "mix" })).toBe("dj_set");
    expect(showTypeOf({ title: "En direct", media: "live" })).toBe("dj_set");
    expect(showTypeOf({ title: "PLAYLIST CLUB DANCE", media: "playlist" })).toBe("playlist");
    expect(showTypeOf({ title: "podcast", media: "live" })).toBe("podcast");
  });
});

describe("l'import de la programmation", () => {
  let connection: Connection;
  let db: Db;
  beforeAll(async () => {
    connection = await freshDb();
    db = connection.db;
  });
  afterAll(() => connection?.close());

  /** Chaque test lit sa propre période (un mois chacune) : les shows des autres n'y sont pas « disparus ». */
  const windowOf = (month: number) => {
    const from = new Date(NOW.getTime() + month * 30 * DAY);
    return { from, to: new Date(from.getTime() + 14 * DAY), day: (n: number, hour = 18) => new Date(from.getTime() + n * DAY + (hour - 12) * 3_600_000) };
  };
  const slot = (fields: Partial<RadioCultSlot> & Pick<RadioCultSlot, "key" | "start">): RadioCultSlot => ({
    series: null,
    title: "Créneau",
    end: new Date(fields.start.getTime() + 2 * 3_600_000),
    media: "mix",
    description: null,
    artists: [],
    ...fields,
  });
  const showOf = async (key: string) => (await db.select().from(show).where(eq(show.radiocultEventId, key)))[0];
  const artistsOf = async (showId: string) =>
    (
      await db
        .select({ name: artist.name })
        .from(showArtist)
        .innerJoin(artist, eq(artist.id, showArtist.artistId))
        .where(eq(showArtist.showId, showId))
        .orderBy(showArtist.position)
    ).map((row) => row.name);

  it("crée un brouillon par créneau nouveau, relié à ses artistes, et l'écrit au journal", async () => {
    const { from, to, day } = windowOf(0);
    await db.insert(artist).values({ name: "Éloïse Fictive", slug: "eloise-fictive", status: "published", role: "resident" });
    const input: ImportInput = {
      from,
      to,
      slots: [
        slot({
          key: "c1",
          title: "Podcast du mardi",
          start: day(3),
          media: "live",
          description: "Une **heure** de mots.",
          artists: [
            { id: "r-eloise", name: "eloise fictive", slug: "", bio: null, links: [] },
            { id: "r-venu", name: "Nouveau Venu", slug: "nouveau-venu", bio: "Né à Paris.", links: [{ label: "SoundCloud", url: "https://soundcloud.com/venu" }] },
            { id: "r-anonyme", name: "", slug: "", bio: null, links: [] },
            { id: "r-venu-bis", name: "NOUVEAU VENU", slug: "", bio: null, links: [] },
          ],
        }),
        slot({ key: "c2", title: "PLAYLIST CLUB DANCE", start: day(1), media: "playlist" }),
      ],
    };
    const result = await importRadioCult(db, input);
    expect(result).toMatchObject({ ok: true, slots: 2, created: 2, updated: 0, unchanged: 0 });
    expect(result.report.created.map((row) => row.title)).toEqual(["PLAYLIST CLUB DANCE", "Podcast du mardi"]);
    expect(result.report.artistsLinked).toEqual([{ id: expect.any(String), name: "Éloïse Fictive" }]);
    expect(result.report.artistsCreated).toEqual([{ id: expect.any(String), name: "Nouveau Venu" }]);
    expect(result.report.notes).toEqual(["Un artiste de Radio Cult sans nom : laissé de côté."]);

    const podcast = await showOf("c1");
    expect(podcast).toMatchObject({
      title: "Podcast du mardi",
      type: "podcast",
      status: "draft",
      slug: expect.stringMatching(/^podcast-du-mardi-2026-\d{2}-\d{2}$/),
      broadcastAt: day(3),
      durationSeconds: 7200,
      description: "Une **heure** de mots.",
    });
    expect(await artistsOf(podcast!.id)).toEqual(["Éloïse Fictive", "Nouveau Venu"]);
    const [venu] = await db.select().from(artist).where(eq(artist.radiocultArtistId, "r-venu"));
    expect(venu).toMatchObject({ name: "Nouveau Venu", slug: "nouveau-venu", status: "draft", role: "guest", bio: "Né à Paris." });
    expect(venu!.links).toEqual([{ label: "SoundCloud", url: "https://soundcloud.com/venu" }]);
    expect((await db.select().from(artist).where(eq(artist.slug, "eloise-fictive")))[0]).toMatchObject({ radiocultArtistId: "r-eloise", status: "published" });
    expect((await showOf("c2"))!.type).toBe("playlist");

    const [journal] = await db.select().from(radiocultImport).where(eq(radiocultImport.id, result.id));
    expect(journal).toMatchObject({ trigger: "cron", memberId: null, error: null, slots: 2, created: 2, rangeStart: from, rangeEnd: to });
  });

  it("se rejoue sans doublon", async () => {
    const { from, to, day } = windowOf(0);
    const again = await importRadioCult(db, {
      from,
      to,
      slots: [
        slot({ key: "c1", title: "Podcast du mardi", start: day(3), media: "live", description: "Une **heure** de mots." }),
        slot({ key: "c2", title: "PLAYLIST CLUB DANCE", start: day(1), media: "playlist" }),
      ],
    });
    expect(again).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 2 });
    expect(await db.select().from(show).where(inArray(show.radiocultEventId, ["c1", "c2"]))).toHaveLength(2);
    expect(await db.select().from(artist).where(inArray(artist.radiocultArtistId, ["r-venu", "r-venu-bis"]))).toHaveLength(1);
  });

  it("fait suivre son créneau à un brouillon, et lui donne les artistes et la description qu'il n'a pas", async () => {
    const { from, to, day } = windowOf(1);
    await importRadioCult(db, { from, to, slots: [slot({ key: "m1", title: "Mix", start: day(2) })] });
    const draft = (await showOf("m1"))!;
    const result = await importRadioCult(db, {
      from,
      to,
      slots: [slot({ key: "m1", title: "Mix renommé", start: day(2, 20), description: "Enfin un texte.", artists: [{ id: "r-mix", name: "DJ Mix", slug: "", bio: null, links: [] }] })],
    });
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    expect(result.report.updated).toEqual([
      { id: draft.id, title: "Mix", slotAt: day(2, 20).toISOString(), slotDuration: 7200, showAt: day(2).toISOString(), showDuration: 7200, filled: ["description", "artists"] },
    ]);
    // Le titre reste celui de la fiche : seuls la date, la durée et ce qui manquait changent.
    expect(await showOf("m1")).toMatchObject({ title: "Mix", broadcastAt: day(2, 20), description: "Enfin un texte." });
    expect(await artistsOf(draft.id)).toEqual(["DJ Mix"]);

    // Des artistes déjà choisis par l'équipe restent les siens.
    await db.update(show).set({ description: "Le texte de l'équipe." }).where(eq(show.id, draft.id));
    const second = await importRadioCult(db, {
      from,
      to,
      slots: [slot({ key: "m1", start: day(2, 20), description: "Autre texte.", artists: [{ id: "r-autre", name: "Autre DJ", slug: "", bio: null, links: [] }] })],
    });
    expect(second).toMatchObject({ updated: 0, unchanged: 1 });
    expect(await showOf("m1")).toMatchObject({ description: "Le texte de l'équipe." });
    expect(await artistsOf(draft.id)).toEqual(["DJ Mix"]);
  });

  it("ne réécrit jamais un show publié : il le signale quand son créneau bouge", async () => {
    const { from, to, day } = windowOf(2);
    await importRadioCult(db, { from, to, slots: [slot({ key: "p1", title: "Publié", start: day(4) })] });
    await db.update(show).set({ status: "published", title: "Publié et retouché" }).where(eq(show.radiocultEventId, "p1"));
    const before = (await showOf("p1"))!;
    const result = await importRadioCult(db, { from, to, slots: [slot({ key: "p1", start: day(5), end: new Date(day(5).getTime() + 3_600_000) })] });
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(result.report.moved).toEqual([
      { id: before.id, title: "Publié et retouché", slotAt: day(5).toISOString(), slotDuration: 3600, showAt: day(4).toISOString(), showDuration: 7200 },
    ]);
    expect(await showOf("p1")).toMatchObject({ broadcastAt: day(4), durationSeconds: 7200, updatedAt: before.updatedAt });
  });

  it("signale un créneau disparu sans rien supprimer", async () => {
    const { from, to, day } = windowOf(3);
    await importRadioCult(db, { from, to, slots: [slot({ key: "g1", title: "Annulé", start: day(6) }), slot({ key: "g2", title: "Maintenu", start: day(7) })] });
    const result = await importRadioCult(db, { from, to, slots: [slot({ key: "g2", title: "Maintenu", start: day(7) })] });
    expect(result.report.gone).toEqual([{ id: (await showOf("g1"))!.id, title: "Annulé", status: "draft", showAt: day(6).toISOString() }]);
    expect(await showOf("g1")).toBeDefined();
  });

  it("garde le show d'une série dont une occurrence change de jour", async () => {
    const { from, to, day } = windowOf(4);
    const tuesday = day(4);
    const wednesday = day(5, 19);
    await importRadioCult(db, { from, to, slots: [slot({ key: "série@mardi", series: "série", title: "Résidence", start: tuesday })] });
    const resident = (await showOf("série@mardi"))!;
    const result = await importRadioCult(db, { from, to, slots: [slot({ key: "série@mercredi", series: "série", title: "Résidence", start: wednesday })] });
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(result.report.gone).toEqual([]);
    expect(await showOf("série@mercredi")).toMatchObject({ id: resident.id, broadcastAt: wednesday });
    expect(await showOf("série@mardi")).toBeUndefined();
  });

  it("garde le jour dans l'adresse d'un show au titre très long", async () => {
    const { from, to, day } = windowOf(8);
    const title = "Une très longue émission de radio dont le titre ne tient pas dans une adresse raisonnable du site";
    await importRadioCult(db, { from, to, slots: [slot({ key: "long", title, start: day(2) })] });
    expect((await showOf("long"))!.slug).toMatch(/^une-tres-longue-emission-.*-\d{4}-\d{2}-\d{2}$/);
  });

  it("note au journal une lecture de Radio Cult qui a échoué, sans rien toucher", async () => {
    const { from, to } = windowOf(5);
    const result = await importRadioCult(db, { from, to, error: "Radio Cult ne répond pas (HTTP 503)." });
    expect(result).toMatchObject({ ok: false, error: "Radio Cult ne répond pas (HTTP 503).", slots: 0, created: 0 });
    expect((await db.select().from(radiocultImport).where(eq(radiocultImport.id, result.id)))[0]).toMatchObject({ error: "Radio Cult ne répond pas (HTTP 503)." });
  });

  it("se lance depuis l'admin au nom d'un membre, jamais d'un compte hors de l'équipe", async () => {
    const { from, to, day } = windowOf(6);
    const editor = await createAccount(db, "editor");
    const result = await createAdmin(db, editor).importRadioCult({ from, to, slots: [slot({ key: "e1", title: "Du bouton", start: day(2), artists: [{ id: "r-bouton", name: "Bouton", slug: "", bio: null, links: [] }] })] });
    expect(result).toMatchObject({ ok: true, created: 1 });
    expect((await db.select().from(radiocultImport).where(eq(radiocultImport.id, result.id)))[0]).toMatchObject({ trigger: "manual", memberId: editor });

    const outsider = await createAccount(db);
    const refused = await pgError(createAdmin(db, outsider).importRadioCult({ from, to, slots: [slot({ key: "e2", start: day(3) })] }));
    expect(refused.code).toBe("42501");
    expect(await showOf("e2")).toBeUndefined();
    // Personne n'écrit au journal au nom d'un autre, ni comme la tâche de nuit.
    const asEditor = createAdmin(db, editor);
    const forged = await pgError(
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: editor, role: "authenticated" })}, true), set_config('role', 'authenticated', true)`);
        await tx.insert(radiocultImport).values({ trigger: "cron", rangeStart: from, rangeEnd: to });
      }),
    );
    expect(forged.code).toBe("42501");
    expect((await asEditor.importStatus()).last).toMatchObject({ trigger: "manual", by: "Membre editor", ok: true, created: 1 });
  });

  it("montre à l'accueil ce qui reste à relire, d'après les fiches d'aujourd'hui", async () => {
    const { from, to, day } = windowOf(7);
    await importRadioCult(db, { from, to, slots: [slot({ key: "s-new", title: "Nouveau", start: day(1) }), slot({ key: "s-pub", title: "En ligne", start: day(2) }), slot({ key: "s-off", title: "Supprimé chez Radio Cult", start: day(3) })] });
    await db.update(show).set({ status: "published" }).where(eq(show.radiocultEventId, "s-pub"));
    await importRadioCult(db, { from, to, slots: [slot({ key: "s-new", title: "Nouveau", start: day(1) }), slot({ key: "s-pub", title: "En ligne", start: day(2, 21) }), slot({ key: "s-x", title: "Tout neuf", start: day(4), artists: [{ id: "r-neuf", name: "Artiste Neuf", slug: "", bio: null, links: [] }] })] });

    const editor = createAdmin(db, await createAccount(db, "editor"));
    const status = await editor.importStatus();
    expect(status.last).toMatchObject({ trigger: "cron", ok: true, by: null, created: 1, unchanged: 2 });
    expect(status.created.map((row) => row.title)).toEqual(["Tout neuf"]);
    expect(status.moved.map((row) => row.title)).toEqual(["En ligne"]);
    expect(status.gone.map((row) => row.title)).toEqual(["Supprimé chez Radio Cult"]);
    expect(status.artistsCreated.map((row) => row.name)).toEqual(["Artiste Neuf"]);

    // Corrigé à la main, supprimé, publié : plus rien à relire, sans attendre le prochain import.
    await db.update(show).set({ broadcastAt: day(2, 21) }).where(eq(show.radiocultEventId, "s-pub"));
    await db.delete(show).where(eq(show.radiocultEventId, "s-off"));
    await db.update(show).set({ status: "published" }).where(eq(show.radiocultEventId, "s-x"));
    await db.update(artist).set({ status: "published" }).where(eq(artist.radiocultArtistId, "r-neuf"));
    const after = await editor.importStatus();
    expect([after.created, after.moved, after.gone, after.artistsCreated]).toEqual([[], [], [], []]);

    // Un échec ensuite : il est le dernier passage, la liste vient toujours du dernier réussi.
    await importRadioCult(db, { from, to, error: "Radio Cult ne répond pas." });
    const failed = await editor.importStatus();
    expect(failed.last).toMatchObject({ ok: false, error: "Radio Cult ne répond pas." });
    expect(failed.lastOk).toMatchObject({ ok: true, created: 1 });
  });

  it("relie une fiche à un artiste de Radio Cult, une seule à la fois", async () => {
    const editor = createAdmin(db, await createAccount(db, "editor"));
    const first = await editor.saveArtist({ values: readArtistForm({ ...emptyArtistForm(), name: "Relié", radiocultArtistId: "r-relie" }).values });
    expect(first.ok).toBe(true);
    const second = await editor.saveArtist({ values: readArtistForm({ ...emptyArtistForm(), name: "Doublon", radiocultArtistId: "r-relie" }).values });
    expect(second).toEqual({ ok: false, errors: { radiocultArtistId: "Cet artiste de Radio Cult est déjà relié à « Relié »." } });
    expect(readArtistForm({ ...emptyArtistForm(), name: "X", radiocultArtistId: "<script>" }).errors.radiocultArtistId).toBeDefined();

    // Sans le champ, le lien ne change pas ; vide, il est retiré.
    const id = (first as { id: string }).id;
    const { radiocultArtistId: _absent, ...withoutLink } = { ...emptyArtistForm(), name: "Relié" };
    await editor.saveArtist({ id, values: readArtistForm(withoutLink).values });
    expect((await db.select().from(artist).where(eq(artist.id, id)))[0]!.radiocultArtistId).toBe("r-relie");
    await editor.saveArtist({ id, values: readArtistForm({ ...emptyArtistForm(), name: "Relié", radiocultArtistId: "" }).values });
    expect((await db.select().from(artist).where(eq(artist.id, id)))[0]!.radiocultArtistId).toBeNull();
    expect((await editor.radiocultLinks()).get("r-relie")).toBeUndefined();
  });
});

describe("l'état de l'import, sans aucun passage", () => {
  it("ne dit rien de plus que « jamais lancé »", async () => {
    const { db, close } = await freshDb();
    try {
      const status = await db.transaction((tx) => importStatus(tx));
      expect(status).toEqual({ last: null, lastOk: null, created: [], updated: [], moved: [], gone: [], artistsCreated: [], notes: [] });
    } finally {
      await close();
    }
  });
});
