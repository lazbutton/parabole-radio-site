/**
 * Les candidatures (src/candidatures/, src/admin/candidatures.ts) : les règles de la saisie, partagées avec la page ;
 * le dépôt par le serveur (types fermés, une candidature en cours par personne, plafond par heure, styles du bon
 * type) ; les règles d'accès ; ce que l'équipe en fait (mettre de côté, noter, le oui qui crée la fiche d'invité et
 * son lien, ou reprend la fiche du même nom, le refus et sa reprise, l'effacement) ; les réglages ; ce que l'accueil en
 * compte ; et le ménage de la nuit.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin } from "../src/admin/index.ts";
import { createCandidatures } from "../src/candidatures/index.ts";
import { adresseWeb, compteInsta, lireCandidature, type CandidatureForm } from "../src/candidatures/regles.ts";
import type { Connection, Db } from "../src/db.ts";
import { application, applicationSettings, applicationTag, artist, artistTag, tag, uploadLink } from "../src/schema.ts";
import { createAccount, freshDb, pgError } from "./helpers.ts";

const NOW = new Date("2026-11-06T10:00:00Z");

/** Une candidature complète de DJ, à varier. */
const form = (changes: Partial<CandidatureForm> = {}): CandidatureForm => ({
  type: "dj_set",
  prete: "oui",
  frequence: "reguliere",
  nom: "Lou Velours",
  ville: "Lyon",
  instagram: "@lou.velours",
  email: "",
  idee: "Un set house et disco du dimanche, avec des raretés funk.",
  lien: "soundcloud.com/exemple/mix-du-dimanche",
  styles: [],
  ...changes,
});

describe("les règles d'une candidature", () => {
  it("reconnaît un compte Instagram d'où qu'il vienne, et une adresse web sans https://", () => {
    expect(compteInsta("@lou.velours")).toBe("lou.velours");
    expect(compteInsta("https://www.instagram.com/lou.velours/?hl=fr")).toBe("lou.velours");
    expect(compteInsta("lou velours")).toBe("");
    expect(adresseWeb("soundcloud.com/exemple/mix")).toBe("https://soundcloud.com/exemple/mix");
    expect(adresseWeb("http://mixcloud.com/x")).toBe("http://mixcloud.com/x");
    expect(adresseWeb("pas une adresse")).toBeNull();
    expect(adresseWeb("javascript:alert(1)")).toBeNull();
    expect(adresseWeb("localhost/x")).toBeNull();
  });

  it("rend des valeurs propres pour une candidature complète", () => {
    const { values, errors } = lireCandidature(form({ nom: "  Lou   Velours ", styles: ["house", "house", "jazz", "rock", "techno"] }));
    expect(errors).toEqual({});
    expect(values).toEqual({
      type: "dj_set",
      ready: true,
      regular: true,
      name: "Lou Velours",
      city: "Lyon",
      instagram: "lou.velours",
      email: null,
      pitch: "Un set house et disco du dimanche, avec des raretés funk.",
      listenUrl: "https://soundcloud.com/exemple/mix-du-dimanche",
      styles: ["house", "jazz", "rock"],
    });
    expect(lireCandidature(form({ frequence: "une-fois" })).values?.regular).toBe(false);
    expect(lireCandidature(form({ frequence: "" })).values?.regular).toBeNull();
  });

  it("dit ce qui manque, champ par champ, avec les messages de la page", () => {
    const { values, errors } = lireCandidature(form({ type: "", prete: "", nom: "L", instagram: "", email: "", idee: "Court", lien: "" }));
    expect(values).toBeNull();
    expect(errors).toEqual({
      type: "Choisis ce que tu proposes.",
      prete: "Dis-nous si ton émission est déjà enregistrée.",
      nom: "Ton nom d'artiste est un peu court.",
      contact: "Laisse ton Instagram ou ton e-mail, pour qu'on puisse te répondre.",
      idee: "Dis-nous-en un peu plus (20 caractères au moins).",
      // sans type choisi, le lien est demandé, comme pour un set
      lien: "Ajoute un lien vers un de tes mixes, pour qu'on t'écoute.",
    });
    expect(lireCandidature(form({ instagram: "lou velours", email: "lou@" })).errors).toEqual({
      instagram: "Ce compte n'a pas l'air juste : des lettres, des chiffres, des points et des _ seulement.",
      email: "Cette adresse e-mail n'a pas l'air complète.",
    });
  });

  it("demande le lien d'écoute pour un set ou une playlist, pas pour un podcast", () => {
    expect(lireCandidature(form({ lien: "" })).errors.lien).toBe("Ajoute un lien vers un de tes mixes, pour qu'on t'écoute.");
    expect(lireCandidature(form({ type: "playlist", lien: "" })).errors.lien).toBe("Ajoute le lien de ta playlist, pour qu'on l'écoute.");
    expect(lireCandidature(form({ type: "podcast", lien: "" })).values?.listenUrl).toBeNull();
    expect(lireCandidature(form({ type: "podcast", lien: "pas un lien" })).errors.lien).toBe("Ce lien n'a pas l'air d'une adresse web.");
  });
});

describe("les candidatures", () => {
  let connection: Connection;
  let db: Db;
  let editorId: string;
  let adminId: string;
  let outsiderId: string;
  let clock = NOW;
  const candidatures = () => createCandidatures(db, { now: () => clock });

  beforeAll(async () => {
    connection = await freshDb();
    db = connection.db;
    editorId = await createAccount(db, "editor");
    adminId = await createAccount(db, "admin");
    outsiderId = await createAccount(db);
  });
  afterAll(async () => {
    await connection.close();
  });

  /** Vide les candidatures entre deux scénarios, et rouvre tout. */
  async function reset() {
    clock = NOW;
    await db.delete(application);
    await db.update(applicationSettings).set({ openTypes: ["dj_set", "podcast", "playlist"], replyDays: 21 });
  }

  it("lisent les réglages posés par la migration et les styles de chaque type", async () => {
    expect(await candidatures().reglages()).toEqual({ openTypes: ["dj_set", "podcast", "playlist"], replyDays: 21 });
    const styles = await candidatures().styles();
    expect(styles.map((one) => one.type)).toEqual(["dj_set", "podcast", "playlist"]);
    expect(styles[0]!.filtre).toBe("Genre");
    expect(styles[0]!.groupes.length).toBeGreaterThan(5);
    expect(styles[1]!.filtre).toBe("Thème");
  });

  it("se déposent, avec les styles de leur type seulement", async () => {
    await reset();
    const [genre] = (await candidatures().styles())[0]!.groupes;
    const [theme] = (await candidatures().styles())[1]!.groupes;
    const done = await candidatures().deposer(form({ styles: [genre!.slug, theme!.slug, "inconnu"] }));
    expect(done.ok).toBe(true);
    const [row] = await db.select().from(application);
    expect(row).toMatchObject({ type: "dj_set", ready: true, regular: true, name: "Lou Velours", instagram: "lou.velours", status: "new", answeredAt: null });
    const tags = await db.select({ slug: tag.slug }).from(applicationTag).innerJoin(tag, eq(tag.id, applicationTag.tagId));
    expect(tags.map((one) => one.slug)).toEqual([genre!.slug]);
  });

  it("revérifient la saisie, refusent un type fermé, et une seconde candidature en cours de la même personne", async () => {
    await reset();
    expect(await candidatures().deposer(form({ nom: "" }))).toMatchObject({ ok: false, status: 422, errors: { nom: expect.any(String) } });
    await db.update(applicationSettings).set({ openTypes: ["podcast"] });
    expect(await candidatures().deposer(form())).toEqual({
      ok: false,
      status: 409,
      errors: { type: "Les DJ sets sont complets pour le moment : choisis un autre type, ou reviens plus tard." },
    });
    await db.update(applicationSettings).set({ openTypes: ["dj_set", "podcast", "playlist"] });
    expect((await candidatures().deposer(form())).ok).toBe(true);
    // Le même compte, écrit autrement : déjà en cours.
    expect(await candidatures().deposer(form({ instagram: "https://instagram.com/LOU.VELOURS" }))).toMatchObject({ ok: false, status: 409 });
    // Une autre personne passe ; la même par son e-mail aussi, une fois la première candidature refusée.
    expect((await candidatures().deposer(form({ instagram: "", email: "autre@exemple.test" }))).ok).toBe(true);
    await db.update(application).set({ status: "declined", answeredAt: NOW }).where(eq(application.instagram, "lou.velours"));
    expect((await candidatures().deposer(form())).ok).toBe(true);
  });

  it("s'arrêtent quand trop arrivent dans l'heure", async () => {
    await reset();
    for (let n = 0; n < 30; n++) expect((await candidatures().deposer(form({ instagram: `personne.${n}` }))).ok).toBe(true);
    expect(await candidatures().deposer(form({ instagram: "une.de.plus" }))).toMatchObject({ ok: false, status: 429 });
    clock = new Date(NOW.getTime() + 61 * 60 * 1000);
    // Les premières sont datées par la base, pas par l'horloge du test : on les vieillit d'une heure.
    await db.update(application).set({ createdAt: sql`created_at - interval '61 minutes'` });
    expect((await candidatures().deposer(form({ instagram: "une.de.plus" }))).ok).toBe(true);
  });

  it("sont fermées au public et à un compte hors de l'équipe ; l'équipe les lit ; seul un admin règle", async () => {
    await reset();
    await candidatures().deposer(form());
    const lire = (viewer: Parameters<typeof withViewer>[1]) => withViewer(db, viewer, (tx) => tx.select({ id: application.id }).from(application));
    expect((await pgError(lire({ role: "anon" }))).code).toBe("42501");
    expect(await lire({ role: "authenticated", userId: outsiderId })).toEqual([]);
    expect(await lire({ role: "authenticated", userId: editorId })).toHaveLength(1);
    expect((await pgError(withViewer(db, { role: "anon" }, (tx) => tx.insert(application).values({ type: "podcast", ready: false, name: "X", pitch: "Une idée assez longue.", email: "x@exemple.test" })))).code).toBe("42501");
    expect((await pgError(withViewer(db, { role: "authenticated", userId: editorId }, (tx) => tx.insert(application).values({ type: "podcast", ready: false, name: "X", pitch: "Une idée assez longue.", email: "x@exemple.test" })))).code).toBe("42501");
    expect(await createAdmin(db, editorId).saveApplicationSettings({ openTypes: ["podcast"], replyDays: 14 })).toEqual({ ok: false, errors: { form: "Seul un admin règle les candidatures." } });
    expect(await createAdmin(db, adminId).saveApplicationSettings({ openTypes: ["podcast", "inconnu"], replyDays: 14 })).toEqual({ ok: true });
    expect(await createAdmin(db, editorId).applicationSettings()).toEqual({ openTypes: ["podcast"], replyDays: 14 });
    expect(await createAdmin(db, adminId).saveApplicationSettings({ openTypes: [], replyDays: 0 })).toMatchObject({ ok: false, errors: { replyDays: expect.any(String) } });
  });

  it("se listent par statut, type, émission prête, retard et recherche ; l'accueil les compte", async () => {
    await reset();
    await candidatures().deposer(form());
    await candidatures().deposer(form({ type: "podcast", prete: "non", instagram: "", email: "ondes@exemple.test", nom: "Les Ondes Courtes", lien: "" }));
    // Une plus ancienne que le délai annoncé (21 jours).
    await candidatures().deposer(form({ instagram: "ancienne", nom: "Ancienne" }));
    await db.update(application).set({ createdAt: new Date("2026-10-01T10:00:00Z") }).where(eq(application.instagram, "ancienne"));
    const admin = createAdmin(db, editorId);
    expect((await admin.listApplications({}, NOW)).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes", "Lou Velours", "Ancienne"]);
    expect((await admin.listApplications({ type: "podcast" }, NOW)).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes"]);
    expect((await admin.listApplications({ ready: "1" }, NOW)).rows.map((row) => row.name)).toEqual(["Lou Velours", "Ancienne"]);
    expect((await admin.listApplications({ late: "1" }, NOW)).rows.map((row) => row.name)).toEqual(["Ancienne"]);
    expect((await admin.listApplications({ q: "ondes" }, NOW)).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes"]);
    expect((await admin.listApplications({}, NOW)).counts).toEqual({ new: 3, shortlisted: 0, accepted: 0, declined: 0 });
    expect(await admin.applicationCounts(NOW)).toEqual({ new: 3, shortlisted: 0, late: 1, ready: 2 });
  });

  it("se mettent de côté et se notent ; le oui crée la fiche d'invité, son activité et son lien d'envoi", async () => {
    await reset();
    await candidatures().deposer(form());
    const [{ id }] = (await db.select({ id: application.id }).from(application)) as [{ id: string }];
    const admin = createAdmin(db, editorId);
    expect(await admin.moveApplication(id, "shortlisted")).toEqual({ ok: true });
    expect(await admin.noteApplication(id, "  À réécouter jeudi  ")).toEqual({ ok: true });
    expect(await admin.getApplication(id, NOW)).toMatchObject({ status: "shortlisted", note: "À réécouter jeudi", artist: null, sameName: null, late: false });

    const accepted = await admin.acceptApplication(id);
    expect(accepted).toMatchObject({ ok: true, artistName: "Lou Velours", reused: false, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    if (!accepted.ok) throw new Error("oui refusé");
    const [fiche] = await db.select().from(artist).where(eq(artist.id, accepted.artistId));
    expect(fiche).toMatchObject({ name: "Lou Velours", slug: "lou-velours", role: "guest", status: "draft", links: [{ label: "Instagram", url: "https://www.instagram.com/lou.velours/" }] });
    const activite = await db.select({ slug: tag.slug }).from(artistTag).innerJoin(tag, eq(tag.id, artistTag.tagId)).where(eq(artistTag.artistId, accepted.artistId));
    expect(activite.map((one) => one.slug)).toEqual(["dj"]);
    const [link] = await db.select().from(uploadLink).where(eq(uploadLink.artistId, accepted.artistId));
    expect(link).toMatchObject({ token: accepted.token, createdBy: editorId });
    const detail = await admin.getApplication(id, NOW);
    expect(detail).toMatchObject({ status: "accepted", answeredBy: "Membre editor", artist: { id: accepted.artistId, name: "Lou Velours", status: "draft", token: accepted.token } });
    // Un second oui rend la même fiche et le même lien ; un refus, une remise à écouter, non.
    expect(await admin.acceptApplication(id)).toMatchObject({ ok: true, artistId: accepted.artistId, token: accepted.token });
    expect(await admin.declineApplication(id)).toMatchObject({ ok: false });
    expect(await admin.moveApplication(id, "new")).toMatchObject({ ok: false });
  });

  it("reprennent la fiche qui porte déjà ce nom, avec son lien s'il en a un", async () => {
    await reset();
    const [existante] = await db.insert(artist).values({ slug: "les-ondes-courtes", name: "Les Ondes Courtes", role: "resident" }).returning({ id: artist.id });
    await candidatures().deposer(form({ type: "podcast", instagram: "", email: "ondes@exemple.test", nom: "les ondes courtes", lien: "" }));
    const [{ id }] = (await db.select({ id: application.id }).from(application)) as [{ id: string }];
    const admin = createAdmin(db, editorId);
    expect((await admin.getApplication(id, NOW))?.sameName).toEqual({ id: existante!.id, name: "Les Ondes Courtes" });
    const accepted = await admin.acceptApplication(id);
    expect(accepted).toMatchObject({ ok: true, artistId: existante!.id, artistName: "Les Ondes Courtes", reused: true });
    const [fiche] = await db.select({ role: artist.role }).from(artist).where(eq(artist.id, existante!.id));
    expect(fiche!.role).toBe("resident");
    expect(await db.select({ id: artist.id }).from(artist).where(sql`lower(${artist.name}) = 'les ondes courtes'`)).toHaveLength(1);
  });

  it("se refusent, se reprennent tant qu'elles ne sont pas effacées, s'effacent à la demande, et la nuit six mois après", async () => {
    await reset();
    await candidatures().deposer(form());
    await candidatures().deposer(form({ instagram: "autre", nom: "Autre" }));
    const rows = await db.select({ id: application.id, name: application.name }).from(application);
    const lou = rows.find((row) => row.name === "Lou Velours")!.id;
    const autre = rows.find((row) => row.name === "Autre")!.id;
    const admin = createAdmin(db, editorId);
    expect(await admin.declineApplication(lou)).toEqual({ ok: true });
    const declined = await admin.getApplication(lou, NOW);
    expect(declined).toMatchObject({ status: "declined", answeredBy: "Membre editor" });
    expect(declined!.erasedAt!.getTime() - declined!.answeredAt!.getTime()).toBeGreaterThan(180 * 86_400_000);
    expect(await admin.moveApplication(lou, "new")).toEqual({ ok: true });
    expect(await admin.getApplication(lou, NOW)).toMatchObject({ status: "new", answeredAt: null, answeredBy: null });
    expect(await admin.declineApplication(lou)).toEqual({ ok: true });
    // La nuit : rien avant six mois, puis le refus disparaît ; l'autre reste.
    expect(await candidatures().menage()).toBe(0);
    await db.update(application).set({ answeredAt: new Date("2026-04-01T10:00:00Z") }).where(eq(application.id, lou));
    expect(await candidatures().menage()).toBe(1);
    expect(await admin.deleteApplication(autre)).toBe("Autre");
    expect(await db.select().from(application)).toEqual([]);
    expect(await admin.deleteApplication(autre)).toBeNull();
  });

  it("gardent leur cohérence dans la base : un contact, une réponse datée", async () => {
    await reset();
    expect((await pgError(db.insert(application).values({ type: "dj_set", ready: true, name: "Sans contact", pitch: "Une idée assez longue." }))).message).toMatch(/application_contact/);
    expect((await pgError(db.insert(application).values({ type: "dj_set", ready: true, name: "X", pitch: "Une idée assez longue.", email: "x@exemple.test", status: "accepted" }))).message).toMatch(/application_answered/);
    expect((await pgError(db.insert(application).values({ type: "dj_set", ready: true, name: "X", pitch: "Une idée assez longue.", instagram: "pas valide !" }))).message).toMatch(/application_instagram/);
  });
});
