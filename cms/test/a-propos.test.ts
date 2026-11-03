/**
 * La page À propos (drizzle/0014_a_propos.sql, 0015_a_propos_acces.sql) : la ligne et les mentions légales posées par
 * la migration, ce que lit le site, la saisie vérifiée, les règles d'accès, et les écritures de l'admin (textes,
 * mentions légales, film).
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin, readAboutForm, readClipFile, type AboutForm, type Admin } from "../src/admin/index.ts";
import type { Connection } from "../src/db.ts";
import { createReader } from "../src/read/index.ts";
import { aboutPage } from "../src/schema.ts";
import { createAccount, exampleDb, MEDIA_BASE, pgError } from "./helpers.ts";

const BLOB = "https://exemple.public.blob.vercel-storage.com/a-propos";

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

/** La page telle que l'écran l'envoie : celle de la base, et ce qu'on y change. */
async function formOf(change: Partial<AboutForm> = {}): Promise<AboutForm> {
  const about = (await editor.about())!;
  const rows = (list: { role: string; name: string; url?: string }[]) => list.map((row) => ({ role: row.role, name: row.name, url: row.url ?? "" }));
  return {
    description: about.description,
    socials: about.socials,
    team: rows(about.team),
    credits: rows(about.credits),
    contactEmail: about.contactEmail ?? "",
    applyText: about.applyText,
    applyUrl: about.applyUrl ?? "",
    applyLabel: about.applyLabel,
    filmTitle: about.filmTitle,
    legal: about.legal,
    ...change,
  };
}

/** Enregistre la page saisie comme à l'écran ; l'échec d'un test qui l'attend réussie se lit tout de suite. */
async function save(change: Partial<AboutForm>) {
  const { values, errors } = readAboutForm(await formOf(change));
  expect(errors).toEqual({});
  const saved = await editor.saveAbout({ version: (await editor.about())!.version, values });
  if (!saved.ok) throw new Error(JSON.stringify(saved.errors));
}

const film = (name: string) => {
  const { values, errors } = readClipFile({
    videoUrl: `${BLOB}/${name}.mp4`,
    posterUrl: `${BLOB}/${name}.jpg`,
    mimeType: "video/mp4",
    size: "48000000",
    duration: "154.2",
    width: "1920",
    height: "1080",
  });
  expect(errors).toEqual({});
  return values;
};

describe("la page posée par la migration", () => {
  it("reprend la page provisoire : description, réseaux, crédits, formulaire des contributeurs, sans film", async () => {
    const about = await site().getAbout();
    expect(about).toMatchObject({
      description: expect.stringContaining("Webradio communautaire du 18ᵉ arrondissement de Paris"),
      socials: [
        { label: "Instagram", url: "https://www.instagram.com/paraboleradio/" },
        { label: "SoundCloud", url: "https://soundcloud.com/parabole-radio" },
      ],
      team: [],
      contactEmail: null,
      apply: { text: expect.stringContaining("contributeurs"), url: expect.stringMatching(/^https:\/\/docs\.google\.com\/forms\//), label: "Music lover ?!" },
      film: null,
    });
    expect(about!.credits.map((credit) => credit.role)).toEqual(["Filtre cathodique", "Allumage et neige", "Icônes"]);
    expect(about!.credits[0]).toEqual({ role: "Filtre cathodique", name: "d'après « CRT scanline filter » de Tellers, CC BY 4.0", url: "https://tellers.ai/free-svg-vfx/crt-scanline-filter" });
  });

  it("publie les mentions légales sur une page à part, avec l'hébergeur", async () => {
    const legal = await site().getPage("mentions-legales");
    expect(legal).toMatchObject({ slug: "mentions-legales", title: "Mentions légales" });
    expect(legal!.body).toContain("Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723");
    expect(legal!.body).toContain("**Directeur ou directrice de la publication**");
  });

  it("n'a qu'une ligne : la base en refuse une seconde", async () => {
    const second = await pgError(connection.db.insert(aboutPage).values({ id: true }));
    expect(second.code).toBe("23505");
    const other = await pgError(connection.db.execute(sql`insert into about_page (id) values (false)`));
    expect(other.code).toBe("23514");
  });
});

describe("la saisie de la page, vérifiée", () => {
  const empty: AboutForm = {
    description: "",
    socials: [],
    team: [],
    credits: [],
    contactEmail: "",
    applyText: "",
    applyUrl: "",
    applyLabel: "Music lover ?!",
    filmTitle: "",
    legal: "",
  };

  it("remet les lignes au propre, oublie les vides, et nomme un réseau saisi sans libellé", () => {
    const { values, errors } = readAboutForm({
      ...empty,
      description: "  Une radio.\r\n\r\nDu 18ᵉ.  ",
      socials: [
        { label: "", url: "instagram.com/paraboleradio" },
        { label: " ", url: " " },
      ],
      team: [
        { role: " Programmation ", name: " Lucas ", url: "/residents/lucas" },
        { role: "", name: "", url: "" },
        { role: "", name: "Inès", url: "ines.fr" },
      ],
      contactEmail: " mailto:Contact@Parabole.fr ",
    });
    expect(errors).toEqual({});
    expect(values).toMatchObject({
      description: "Une radio.\n\nDu 18ᵉ.",
      socials: [{ label: "Instagram", url: "https://instagram.com/paraboleradio" }],
      team: [
        { role: "Programmation", name: "Lucas", url: "/residents/lucas" },
        { role: "", name: "Inès", url: "https://ines.fr" },
      ],
      contactEmail: "Contact@Parabole.fr",
      applyUrl: null,
    });
    expect(readAboutForm({ ...empty, credits: [{ role: "Site", name: "Studio", url: "" }] }).values.credits).toEqual([{ role: "Site", name: "Studio" }]);
  });

  it("fait d'une adresse e-mail tapée comme lien de CANDIDATER un lien mailto", () => {
    expect(readAboutForm({ ...empty, applyUrl: "candidature@parabole.fr" }).values.applyUrl).toBe("mailto:candidature@parabole.fr");
    expect(readAboutForm({ ...empty, applyUrl: "forms.gle/abc" }).values.applyUrl).toBe("https://forms.gle/abc");
  });

  it("signale chaque champ fautif à sa place", () => {
    const { errors } = readAboutForm({
      ...empty,
      socials: [{ label: "Insta", url: "pas une adresse" }],
      team: [{ role: "Régie", name: "", url: "" }],
      credits: [{ role: "", name: "Studio", url: "javascript:alert(1)" }],
      contactEmail: "contact@parabole",
      applyUrl: "ftp://exemple.fr",
      applyLabel: "  ",
      legal: "x".repeat(20_001),
    });
    expect(errors).toEqual({
      "socials.0.url": "Une adresse complète : https://…",
      "team.0.name": "Le nom manque.",
      "credits.0.url": expect.stringContaining("/residents/"),
      contactEmail: "Une adresse e-mail : nom@domaine.fr",
      applyUrl: expect.any(String),
      applyLabel: "Le bouton a besoin d'un texte.",
      legal: "20000 caractères au plus.",
    });
    expect(readAboutForm({ ...empty, applyLabel: "x".repeat(41) }).errors).toEqual({ applyLabel: "40 caractères au plus." });
  });
});

describe("les règles d'accès de la page", () => {
  it("la montrent au public, et lui refusent toute écriture", async () => {
    const seen = await withViewer(connection.db, { role: "anon" }, (tx) => tx.select({ description: aboutPage.description }).from(aboutPage));
    expect(seen).toHaveLength(1);
    const update = await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.update(aboutPage).set({ description: "Piraté" })));
    expect(update.code).toBe("42501");
    const truncate = await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.execute(sql`truncate about_page`)));
    expect(truncate.code).toBe("42501");
    const remove = await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.delete(aboutPage)));
    expect(remove.code).toBe("42501");
  });

  it("ne laissent rien écrire à un compte hors de l'équipe", async () => {
    const before = (await editor.about())!;
    const { values } = readAboutForm(await formOf({ description: "Piraté" }));
    expect(await stranger.saveAbout({ values })).toEqual({ ok: false, errors: { form: expect.stringContaining("refuse") } });
    expect(await stranger.setAboutFilm(film("intrus"))).toEqual({ ok: false, errors: { form: expect.stringContaining("refuse") } });
    const after = (await editor.about())!;
    expect(after.description).toBe(before.description);
    expect(after.film).toBeNull();
    expect(after.legal).toBe(before.legal);
  });
});

describe("la page dans l'admin", () => {
  it("enregistre les textes et les listes, que le site lit aussitôt", async () => {
    await save({
      description: "Parabole, la radio du 18ᵉ.",
      team: [{ role: "Programmation", name: "Lucas", url: "" }],
      contactEmail: "contact@parabole.fr",
      applyLabel: "Music lover ?!",
    });
    expect(await site().getAbout()).toMatchObject({
      description: "Parabole, la radio du 18ᵉ.",
      team: [{ role: "Programmation", name: "Lucas" }],
      contactEmail: "contact@parabole.fr",
    });
  });

  it("enregistre les mentions légales sur leur page, et la recrée si elle manque", async () => {
    await save({ legal: "## Éditeur\n\nParabole Radio." });
    expect((await site().getPage("mentions-legales"))!.body).toBe("## Éditeur\n\nParabole Radio.");
    await connection.db.execute(sql`delete from page where slug = 'mentions-legales'`);
    expect((await editor.about())!.legal).toBe("");
    await save({ legal: "Recréée." });
    expect(await site().getPage("mentions-legales")).toMatchObject({ title: "Mentions légales", body: "Recréée." });
  });

  it("signale un enregistrement fait par quelqu'un d'autre entre-temps", async () => {
    const opened = (await editor.about())!.version;
    await save({ applyText: "Écris-nous." });
    const { values } = readAboutForm(await formOf({ applyText: "Ma version." }));
    const late = await editor.saveAbout({ version: opened, values });
    expect(late).toMatchObject({ ok: false, version: (await editor.about())!.version, errors: { form: expect.stringContaining("Quelqu'un") } });
    expect((await site().getAbout())!.apply.text).toBe("Écris-nous.");
    // Renvoyée avec la version de l'autre, la saisie la remplace.
    expect(await editor.saveAbout({ version: (late as { version: string }).version, values })).toEqual({ ok: true });
    expect((await site().getAbout())!.apply.text).toBe("Ma version.");
  });

  it("met un film, change son image fixe, le remplace et l'enlève, en rendant les fichiers devenus inutiles", async () => {
    const version = (await editor.about())!.version;
    const placed = await editor.setAboutFilm(film("premier"), version);
    expect(placed).toEqual({ ok: true, previous: [], version: expect.any(String) });
    expect((placed as { version: string }).version).not.toBe(version);
    expect((await site().getAbout())!.film).toEqual({
      src: `${BLOB}/premier.mp4`,
      type: "video/mp4",
      poster: `${BLOB}/premier.jpg`,
      title: "",
      width: 1920,
      height: 1080,
      durationSeconds: 154,
    });

    expect(await editor.setAboutPoster(`${BLOB}/image.jpg`)).toEqual({ ok: true, previous: [`${BLOB}/premier.jpg`], version: null });
    expect((await site().getAbout())!.film?.poster).toBe(`${BLOB}/image.jpg`);

    expect(await editor.setAboutFilm(film("second"))).toEqual({ ok: true, previous: [`${BLOB}/premier.mp4`, `${BLOB}/image.jpg`], version: null });
    expect((await site().getAbout())!.film?.src).toBe(`${BLOB}/second.mp4`);
    // Le titre du film s'enregistre avec les textes, sans toucher au film.
    await save({ filmTitle: "Parabole, le film" });
    expect((await site().getAbout())!.film).toMatchObject({ src: `${BLOB}/second.mp4`, title: "Parabole, le film" });

    expect(await editor.setAboutFilm(null)).toEqual({ ok: true, previous: [`${BLOB}/second.mp4`, `${BLOB}/second.jpg`], version: null });
    expect((await site().getAbout())!.film).toBeNull();
    expect(await editor.setAboutPoster(`${BLOB}/seule.jpg`)).toEqual({ ok: false, errors: { film: expect.any(String) } });
  });

  it("refuse dans la base un film sans type, ou d'un type que le site ne passe pas", async () => {
    const missing = await pgError(connection.db.update(aboutPage).set({ filmUrl: `${BLOB}/x.mp4` }));
    expect(missing.code).toBe("23514");
    const wrong = await pgError(connection.db.update(aboutPage).set({ filmUrl: `${BLOB}/x.mov`, filmMimeType: "video/quicktime" }));
    expect(wrong.code).toBe("23514");
  });
});
