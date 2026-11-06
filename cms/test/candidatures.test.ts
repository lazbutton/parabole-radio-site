/**
 * Les candidatures (src/candidatures/, src/admin/candidatures.ts) : les règles de la saisie, partagées avec la page ;
 * le dossier de l'envoi (ouvert après Turnstile, mis à jour, refusé si le type est complet, si la personne a déjà une
 * candidature en cours, ou au-delà du plafond par heure) ; le son déposé dans le seau, la photo, l'envoi ; les règles
 * d'accès ; ce que l'équipe en fait (la liste, noter, mettre de côté, valider, qui crée la fiche d'invité et l'émission
 * avec son son validé, ou reprend la fiche du même nom sans rien écraser ; le refus, qui retire le son et la photo ;
 * l'effacement) ; les réglages ; ce que compte l'accueil ; et le ménage de la nuit.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin, UPLOAD_FOLDER } from "../src/admin/index.ts";
import { createCandidatures } from "../src/candidatures/index.ts";
import { adresseWeb, compteInsta, lireCandidature, lireDossier, lireEnvoi, type CandidatureForm } from "../src/candidatures/regles.ts";
import type { Connection, Db } from "../src/db.ts";
import { application, applicationSettings, applicationTag, artist, artistTag, audioFile, media, show, showArtist, showTag, submission, tag, track } from "../src/schema.ts";
import { createAccount, freshDb, pgError } from "./helpers.ts";

const NOW = new Date("2026-11-06T10:00:00Z");

/** Une candidature complète de DJ, à varier. */
const form = (changes: Partial<CandidatureForm> = {}): CandidatureForm => ({
  type: "dj_set",
  frequence: "reguliere",
  titre: "Disco du dimanche",
  description: "Un set house et disco du dimanche, avec des raretés funk.",
  styles: [],
  nom: "Lou Velours",
  bio: "DJ à Lyon, je mixe de la house et du disco depuis dix ans.",
  ville: "Lyon",
  instagram: "@lou.velours",
  email: "",
  lien: "",
  tracklist: "",
  message: "",
  ...changes,
});

/** Une image comme la route la dépose : ses versions sous images/. */
const image = (n: number) => ({
  key: `${UPLOAD_FOLDER}2026/11/0000000${n}-0000-4000-8000-000000000000-800.webp`,
  sizeBytes: 1000,
  width: 800,
  height: 800,
  variants: [{ width: 800, key: `${UPLOAD_FOLDER}2026/11/0000000${n}-0000-4000-8000-000000000000-800.webp` }],
});

describe("les règles d'une candidature", () => {
  it("reconnaissent un compte Instagram d'où qu'il vienne, et une adresse web sans https://", () => {
    expect(compteInsta("@lou.velours")).toBe("lou.velours");
    expect(compteInsta("https://www.instagram.com/lou.velours/?hl=fr")).toBe("lou.velours");
    expect(compteInsta("lou velours")).toBe("");
    expect(adresseWeb("deezer.com/playlist/1")).toBe("https://deezer.com/playlist/1");
    expect(adresseWeb("pas une adresse")).toBeNull();
    expect(adresseWeb("javascript:alert(1)")).toBeNull();
  });

  it("rendent l'émission et l'artiste propres (écrans 1 et 2)", () => {
    const { values, errors } = lireDossier(form({ nom: "  Lou   Velours ", titre: " Disco  du dimanche ", styles: ["house", "house", "jazz", "rock", "techno"] }));
    expect(errors).toEqual({});
    expect(values).toEqual({
      type: "dj_set",
      regular: true,
      title: "Disco du dimanche",
      pitch: "Un set house et disco du dimanche, avec des raretés funk.",
      styles: ["house", "jazz", "rock"],
      name: "Lou Velours",
      bio: "DJ à Lyon, je mixe de la house et du disco depuis dix ans.",
      city: "Lyon",
      instagram: "lou.velours",
      email: null,
    });
  });

  it("disent ce qui manque, champ par champ, avec les messages de la page", () => {
    expect(lireDossier(form({ type: "", titre: "", description: "Court", nom: "L", bio: "", instagram: "", email: "" })).errors).toEqual({
      type: "Choisis ce que tu proposes.",
      titre: "Donne un titre à ton émission.",
      description: "Dis-nous-en un peu plus (20 caractères au moins).",
      nom: "Ton nom d'artiste est un peu court.",
      bio: "Présente-toi en quelques lignes : ce sera ta bio sur le site.",
      contact: "Laisse ton Instagram ou ton e-mail, pour qu'on puisse te répondre.",
    });
    expect(lireDossier(form({ instagram: "lou velours", email: "lou@" })).errors).toEqual({
      instagram: "Ce compte n'a pas l'air juste : des lettres, des chiffres, des points et des _ seulement.",
      email: "Cette adresse e-mail n'a pas l'air complète.",
    });
  });

  it("demandent le MP3, ou pour une playlist son lien ; la tracklist et le mot restent facultatifs", () => {
    expect(lireEnvoi(form(), { aSon: false }).errors).toEqual({ son: "Ajoute le MP3 de ton émission." });
    expect(lireEnvoi(form({ type: "playlist" }), { aSon: false }).errors).toEqual({ son: "Ajoute le MP3 de ta playlist, ou son lien." });
    expect(lireEnvoi(form({ type: "playlist", lien: "pas un lien" }), { aSon: false }).errors).toEqual({ lien: "Ce lien n'a pas l'air d'une adresse web." });
    expect(lireEnvoi(form({ type: "playlist", lien: "deezer.com/playlist/1" }), { aSon: false }).values).toEqual({ listenUrl: "https://deezer.com/playlist/1", tracklist: null, message: null });
    // Un set n'envoie pas de lien, même s'il en reste un dans le brouillon.
    expect(lireEnvoi(form({ lien: "deezer.com/x", tracklist: " 00:00 A – B ", message: " Merci ! " }), { aSon: true }).values).toEqual({ listenUrl: null, tracklist: "00:00 A – B", message: "Merci !" });
    expect(lireCandidature(form({ titre: "" }), { aSon: false }).errors).toEqual({ titre: "Donne un titre à ton émission.", son: "Ajoute le MP3 de ton émission." });
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
    await db.delete(show);
    await db.delete(artist);
    await db.update(applicationSettings).set({ openTypes: ["dj_set", "podcast", "playlist"], replyDays: 21 });
  }

  /** Une candidature envoyée en entier : le dossier, le son déposé (de cette taille), l'envoi. Rend son identifiant. */
  async function envoyer(changes: Partial<CandidatureForm> = {}, { taille = 140_000_000 }: { taille?: number | null } = {}): Promise<string> {
    const ouvert = await candidatures().ouvrirDossier(form(changes));
    if (!ouvert.ok) throw new Error(JSON.stringify(ouvert.errors));
    let son: { id: string; size: number } | null = null;
    if (taille) {
      const prepare = await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: taille });
      if (!prepare.ok) throw new Error(JSON.stringify(prepare.errors));
      son = { id: prepare.id, size: taille };
    }
    const depot = await candidatures().deposer(ouvert.jeton, form(changes), son);
    if (!depot.ok) throw new Error(JSON.stringify(depot.errors));
    return depot.id;
  }

  it("lisent les réglages posés par la migration et les styles de chaque type", async () => {
    expect(await candidatures().reglages()).toEqual({ openTypes: ["dj_set", "podcast", "playlist"], replyDays: 21 });
    const styles = await candidatures().styles();
    expect(styles.map((one) => [one.type, one.filtre])).toEqual([
      ["dj_set", "Genre"],
      ["podcast", "Thème"],
      ["playlist", "Genre"],
    ]);
    expect(styles[0]!.groupes.length).toBeGreaterThan(5);
  });

  it("ouvrent un dossier, le mettent à jour, puis l'envoient avec son son ; le jeton ne sert plus ensuite", async () => {
    await reset();
    const [genre] = (await candidatures().styles())[0]!.groupes;
    const [theme] = (await candidatures().styles())[1]!.groupes;
    const ouvert = await candidatures().ouvrirDossier(form({ styles: [genre!.slug, theme!.slug, "inconnu"] }));
    if (!ouvert.ok) throw new Error("dossier refusé");
    expect(ouvert.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [ligne] = await db.select().from(application);
    // La base ne garde que l'empreinte du jeton ; le dossier n'est pas encore une candidature envoyée.
    expect(ligne).toMatchObject({ title: "Disco du dimanche", status: "new", submittedAt: null, ready: true });
    expect(ligne!.dossierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ligne!.dossierHash).not.toContain(ouvert.jeton);
    // Revenir en arrière met le même dossier à jour.
    expect(await candidatures().ouvrirDossier(form({ titre: "Disco du lundi", styles: [genre!.slug] }), ouvert.jeton)).toEqual({ ok: true, jeton: ouvert.jeton });
    expect(await db.select({ title: application.title }).from(application)).toEqual([{ title: "Disco du lundi" }]);

    // Le son : un MP3 seulement ; un nouveau remplace le précédent (sa clé est rendue pour le seau).
    expect(await candidatures().preparerSon(ouvert.jeton, { fileName: "set.wav", size: 1000 })).toMatchObject({ ok: false, errors: { son: expect.stringMatching(/MP3/) } });
    expect(await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: 800_000_000 })).toMatchObject({ ok: false, errors: { son: "Ce fichier dépasse 750 Mo." } });
    const premier = await candidatures().preparerSon(ouvert.jeton, { fileName: "premier.mp3", size: 1000 });
    const second = await candidatures().preparerSon(ouvert.jeton, { fileName: "Mon set.mp3", size: 140_000_000 });
    if (!premier.ok || !second.ok) throw new Error("son refusé");
    expect(premier.removedKeys).toEqual([]);
    expect(second.removedKeys).toEqual([premier.key]);
    expect(await candidatures().cleSon(ouvert.jeton, premier.id)).toBeNull();
    expect(second.key).toMatch(/^audio\/2026\/11\/[0-9a-f-]{36}\.mp3$/);
    expect(await candidatures().cleSon(ouvert.jeton, second.id)).toBe(second.key);
    expect(await candidatures().cleSon("x".repeat(43), second.id)).toBeNull();

    // L'envoi : le second son, arrivé.
    const depot = await candidatures().deposer(ouvert.jeton, form({ titre: "Disco du lundi", styles: [genre!.slug], tracklist: "00:00 A – B" }), { id: second.id, size: 140_000_000 });
    expect(depot).toMatchObject({ ok: true, removedKeys: [] });
    const [envoyee] = await db.select().from(application);
    expect(envoyee).toMatchObject({ dossierHash: null, tracklist: "00:00 A – B", status: "new" });
    expect(envoyee!.submittedAt).toBeInstanceOf(Date);
    expect(await db.select({ status: audioFile.status, size: audioFile.sizeBytes, applicationId: audioFile.applicationId, fileName: audioFile.fileName }).from(audioFile)).toEqual([
      { status: "received", size: 140_000_000, applicationId: envoyee!.id, fileName: "Mon set.mp3" },
    ]);
    const tags = await db.select({ slug: tag.slug }).from(applicationTag).innerJoin(tag, eq(tag.id, applicationTag.tagId));
    expect(tags.map((one) => one.slug)).toEqual([genre!.slug]);
    // Le jeton ne sert plus.
    expect(await candidatures().preparerSon(ouvert.jeton, { fileName: "x.mp3", size: 10 })).toMatchObject({ ok: false, status: 404 });
    expect(await candidatures().deposer(ouvert.jeton, form(), null)).toMatchObject({ ok: false, status: 404 });
  });

  it("refusent un envoi sans son (sauf le lien d'une playlist), un type complet, une seconde candidature en cours, et au-delà du plafond", async () => {
    await reset();
    const ouvert = await candidatures().ouvrirDossier(form());
    if (!ouvert.ok) throw new Error("dossier refusé");
    // Un second dossier de la même personne, ouvert à côté avant l'envoi du premier.
    const jumeau = await candidatures().ouvrirDossier(form());
    if (!jumeau.ok) throw new Error("second dossier refusé");
    expect(await candidatures().deposer(ouvert.jeton, form(), null)).toMatchObject({ ok: false, status: 422, errors: { son: "Ajoute le MP3 de ton émission." } });
    const prepare = await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: 1000 });
    if (!prepare.ok) throw new Error("son refusé");
    // Un son annoncé mais d'un autre dossier ne passe pas.
    expect(await candidatures().deposer(ouvert.jeton, form(), { id: "00000000-0000-4000-8000-000000000000", size: 10 })).toMatchObject({ ok: false, errors: { son: expect.any(String) } });
    expect((await candidatures().deposer(ouvert.jeton, form(), { id: prepare.id, size: 1000 })).ok).toBe(true);
    // Le second ne part plus : la première est en cours.
    expect(await candidatures().deposer(jumeau.jeton, form(), { id: prepare.id, size: 1000 })).toMatchObject({ ok: false, status: 409 });
    // La même personne, écrite autrement : déjà en cours.
    expect(await candidatures().ouvrirDossier(form({ instagram: "https://instagram.com/LOU.VELOURS" }))).toMatchObject({ ok: false, status: 409 });
    // Une playlist par son lien seulement.
    expect((await envoyer({ type: "playlist", instagram: "", email: "liste@exemple.test", lien: "deezer.com/playlist/1" }, { taille: null })).length).toBe(36);
    await db.update(applicationSettings).set({ openTypes: ["podcast"] });
    expect(await candidatures().ouvrirDossier(form({ instagram: "autre" }))).toEqual({
      ok: false,
      status: 409,
      errors: { type: "Les DJ sets sont complets pour le moment : choisis un autre type, ou reviens plus tard." },
    });
    await db.update(applicationSettings).set({ openTypes: ["dj_set", "podcast", "playlist"] });
    await db.delete(application);
    for (let n = 0; n < 30; n++) expect((await candidatures().ouvrirDossier(form({ instagram: `personne.${n}` }))).ok).toBe(true);
    expect(await candidatures().ouvrirDossier(form({ instagram: "une.de.plus" }))).toMatchObject({ ok: false, status: 429 });
  });

  it("inscrivent la photo du dossier, la remplacent et la retirent", async () => {
    await reset();
    const ouvert = await candidatures().ouvrirDossier(form());
    if (!ouvert.ok) throw new Error("dossier refusé");
    const premiere = await candidatures().ajouterPhoto(ouvert.jeton, image(1));
    if (!premiere.ok) throw new Error("photo refusée");
    expect(premiere.removedImages).toEqual([]);
    const seconde = await candidatures().ajouterPhoto(ouvert.jeton, image(2));
    if (!seconde.ok) throw new Error("photo refusée");
    // la clé de l'image et celle de sa version la plus grande : la même, ici
    expect([...new Set(seconde.removedImages)]).toEqual([image(1).key]);
    expect((await db.select({ photoId: application.photoId }).from(application))[0]!.photoId).toBe(seconde.media.id);
    // son texte alternatif : le nom de l'artiste
    expect(seconde.media.alt).toBe("Lou Velours");
    expect(await candidatures().dossierOuvert(ouvert.jeton)).toBe(true);
    expect(await candidatures().dossierOuvert("z".repeat(43))).toBe(false);
    expect([...new Set(await candidatures().retirerPhoto(ouvert.jeton))]).toEqual([image(2).key]);
    expect(await db.select().from(media)).toEqual([]);
    expect(await candidatures().ajouterPhoto("y".repeat(43), image(3))).toMatchObject({ ok: false });
  });

  it("sont fermées au public et à un compte hors de l'équipe ; l'équipe les lit ; seul un admin règle", async () => {
    await reset();
    await envoyer();
    const lire = (viewer: Parameters<typeof withViewer>[1]) => withViewer(db, viewer, (tx) => tx.select({ id: application.id }).from(application));
    expect((await pgError(lire({ role: "anon" }))).code).toBe("42501");
    expect(await lire({ role: "authenticated", userId: outsiderId })).toEqual([]);
    expect(await lire({ role: "authenticated", userId: editorId })).toHaveLength(1);
    expect(
      (await pgError(withViewer(db, { role: "authenticated", userId: editorId }, (tx) => tx.insert(application).values({ type: "podcast", name: "X", pitch: "Une idée assez longue.", email: "x@exemple.test", submittedAt: NOW })))).code,
    ).toBe("42501");
    expect(await createAdmin(db, editorId).saveApplicationSettings({ openTypes: ["podcast"], replyDays: 14 })).toEqual({ ok: false, errors: { form: "Seul un admin règle les candidatures." } });
    expect(await createAdmin(db, adminId).saveApplicationSettings({ openTypes: ["podcast", "inconnu"], replyDays: 14 })).toEqual({ ok: true });
    expect(await createAdmin(db, editorId).applicationSettings()).toEqual({ openTypes: ["podcast"], replyDays: 14 });
  });

  it("se listent une fois envoyées seulement, par statut, type, retard et recherche ; l'accueil les compte", async () => {
    await reset();
    await envoyer();
    await envoyer({ type: "podcast", instagram: "", email: "ondes@exemple.test", nom: "Les Ondes Courtes", titre: "Radio pirate" });
    await envoyer({ instagram: "ancienne", nom: "Ancienne", titre: "Vieux set" });
    await db.update(application).set({ submittedAt: new Date("2026-10-01T10:00:00Z") }).where(eq(application.instagram, "ancienne"));
    // Un dossier pas encore envoyé n'existe pas pour l'équipe.
    await candidatures().ouvrirDossier(form({ instagram: "en.cours", nom: "En cours" }));
    const admin = createAdmin(db, editorId);
    expect((await admin.listApplications({}, NOW)).rows.map((row) => [row.name, row.title, row.hasSound])).toEqual([
      ["Les Ondes Courtes", "Radio pirate", true],
      ["Lou Velours", "Disco du dimanche", true],
      ["Ancienne", "Vieux set", true],
    ]);
    expect((await admin.listApplications({ type: "podcast" }, NOW)).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes"]);
    expect((await admin.listApplications({ late: "1" }, NOW)).rows.map((row) => row.name)).toEqual(["Ancienne"]);
    expect((await admin.listApplications({ q: "pirate" }, NOW)).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes"]);
    expect((await admin.listApplications({}, NOW)).counts).toEqual({ new: 3, shortlisted: 0, accepted: 0, declined: 0 });
    expect(await admin.applicationCounts(NOW)).toEqual({ new: 3, shortlisted: 0, late: 1 });
  });

  it("se valident : la fiche d'invité, l'émission en brouillon, ses styles, sa tracklist, l'envoi et le son validé", async () => {
    await reset();
    const [genre] = (await candidatures().styles())[0]!.groupes;
    const ouvert = await candidatures().ouvrirDossier(form({ styles: [genre!.slug] }));
    if (!ouvert.ok) throw new Error("dossier refusé");
    const photo = await candidatures().ajouterPhoto(ouvert.jeton, image(4));
    const son = await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: 1000 });
    if (!photo.ok || !son.ok) throw new Error("refusé");
    const depot = await candidatures().deposer(ouvert.jeton, form({ styles: [genre!.slug], tracklist: "00:00 Artiste Un – Titre un\n12:30 Artiste Deux – Titre deux", message: "Merci !" }), { id: son.id, size: 1000 });
    if (!depot.ok) throw new Error("envoi refusé");
    const admin = createAdmin(db, editorId);
    expect(await admin.moveApplication(depot.id, "shortlisted")).toEqual({ ok: true });
    expect(await admin.noteApplication(depot.id, "  À placer un dimanche  ")).toEqual({ ok: true });
    expect(await admin.getApplication(depot.id, NOW)).toMatchObject({
      status: "shortlisted",
      title: "Disco du dimanche",
      bio: "DJ à Lyon, je mixe de la house et du disco depuis dix ans.",
      photo: { id: photo.media.id },
      sound: { id: son.id, fileName: "set.mp3", status: "received" },
      note: "À placer un dimanche",
      message: "Merci !",
      styles: [{ slug: genre!.slug }],
      artist: null,
      show: null,
      sameName: null,
    });

    const accepted = await admin.acceptApplication(depot.id);
    if (!accepted.ok) throw new Error(JSON.stringify(accepted.errors));
    expect(accepted).toMatchObject({ artistName: "Lou Velours", showTitle: "Disco du dimanche", reused: false });
    const [fiche] = await db.select().from(artist).where(eq(artist.id, accepted.artistId));
    expect(fiche).toMatchObject({
      name: "Lou Velours",
      slug: "lou-velours",
      role: "guest",
      status: "draft",
      bio: "DJ à Lyon, je mixe de la house et du disco depuis dix ans.",
      photoId: photo.media.id,
      links: [{ label: "Instagram", url: "https://www.instagram.com/lou.velours/" }],
    });
    const activite = await db.select({ slug: tag.slug }).from(artistTag).innerJoin(tag, eq(tag.id, artistTag.tagId)).where(eq(artistTag.artistId, accepted.artistId));
    expect(activite.map((one) => one.slug)).toEqual(["dj"]);
    const [emission] = await db.select().from(show).where(eq(show.id, accepted.showId));
    expect(emission).toMatchObject({ title: "Disco du dimanche", slug: "disco-du-dimanche", type: "dj_set", status: "draft", description: "Un set house et disco du dimanche, avec des raretés funk.", broadcastAt: null });
    expect(await db.select({ artistId: showArtist.artistId }).from(showArtist).where(eq(showArtist.showId, accepted.showId))).toEqual([{ artistId: accepted.artistId }]);
    expect((await db.select({ slug: tag.slug }).from(showTag).innerJoin(tag, eq(tag.id, showTag.tagId)).where(eq(showTag.showId, accepted.showId))).map((one) => one.slug)).toEqual([genre!.slug]);
    expect(await db.select({ position: track.position, artist: track.artist, title: track.title, start: track.startSeconds }).from(track).where(eq(track.showId, accepted.showId)).orderBy(track.position)).toEqual([
      { position: 1, artist: "Artiste Un", title: "Titre un", start: 0 },
      { position: 2, artist: "Artiste Deux", title: "Titre deux", start: 750 },
    ]);
    expect(await db.select({ artistId: submission.artistId, note: submission.note, link: submission.link }).from(submission).where(eq(submission.showId, accepted.showId))).toEqual([
      { artistId: accepted.artistId, note: "Merci !", link: null },
    ]);
    expect(await db.select({ showId: audioFile.showId, applicationId: audioFile.applicationId, status: audioFile.status }).from(audioFile)).toEqual([
      { showId: accepted.showId, applicationId: null, status: "approved" },
    ]);
    expect(await admin.getApplication(depot.id, NOW)).toMatchObject({
      status: "accepted",
      answeredBy: "Membre editor",
      artist: { id: accepted.artistId, status: "draft" },
      show: { id: accepted.showId, title: "Disco du dimanche" },
      sound: { id: son.id, status: "approved" },
    });
    // Une seconde validation rend la même émission ; un refus, une remise à écouter, non.
    expect(await admin.acceptApplication(depot.id)).toMatchObject({ ok: true, showId: accepted.showId, artistId: accepted.artistId });
    expect(await admin.declineApplication(depot.id)).toMatchObject({ ok: false });
    expect(await admin.moveApplication(depot.id, "new")).toMatchObject({ ok: false });
  });

  it("reprennent la fiche qui porte déjà ce nom sans rien écraser, et ne valident rien sans son ni lien", async () => {
    await reset();
    const [existante] = await db
      .insert(artist)
      .values({ slug: "les-ondes-courtes", name: "Les Ondes Courtes", role: "resident", bio: "Leur vraie bio." })
      .returning({ id: artist.id });
    const id = await envoyer({ type: "podcast", instagram: "", email: "ondes@exemple.test", nom: "les ondes courtes", titre: "Radio pirate", bio: "Une bio inventée pour prendre leur place." });
    const admin = createAdmin(db, editorId);
    expect((await admin.getApplication(id, NOW))?.sameName).toEqual({ id: existante!.id, name: "Les Ondes Courtes" });
    const accepted = await admin.acceptApplication(id);
    expect(accepted).toMatchObject({ ok: true, artistId: existante!.id, reused: true });
    const [fiche] = await db.select({ role: artist.role, bio: artist.bio }).from(artist).where(eq(artist.id, existante!.id));
    expect(fiche).toEqual({ role: "resident", bio: "Leur vraie bio." });
    expect(await db.select({ id: artist.id }).from(artist).where(sql`lower(${artist.name}) = 'les ondes courtes'`)).toHaveLength(1);
    // Une candidature d'avant le son, sans lien : rien à valider.
    await db.insert(application).values({ type: "dj_set", name: "Ancien", pitch: "Une idée assez longue pour passer.", instagram: "ancien", submittedAt: NOW });
    const [ancienne] = await db.select({ id: application.id }).from(application).where(eq(application.name, "Ancien"));
    expect(await admin.acceptApplication(ancienne!.id)).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/rien à valider/) } });
  });

  it("se refusent (le son et la photo partent tout de suite), se reprennent, s'effacent ; la nuit oublie les dossiers et les vieux refus", async () => {
    await reset();
    const ouvert = await candidatures().ouvrirDossier(form());
    if (!ouvert.ok) throw new Error("dossier refusé");
    await candidatures().ajouterPhoto(ouvert.jeton, image(5));
    const son = await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: 1000 });
    if (!son.ok) throw new Error("son refusé");
    const depot = await candidatures().deposer(ouvert.jeton, form(), { id: son.id, size: 1000 });
    if (!depot.ok) throw new Error("envoi refusé");
    const autre = await envoyer({ instagram: "autre", nom: "Autre" });
    const admin = createAdmin(db, editorId);
    const refus = await admin.declineApplication(depot.id);
    expect(refus).toMatchObject({ ok: true, keys: [son.key] });
    if (refus.ok) expect([...new Set(refus.images)]).toEqual([image(5).key]);
    expect(await db.select().from(audioFile).where(eq(audioFile.applicationId, depot.id))).toEqual([]);
    const declined = await admin.getApplication(depot.id, NOW);
    expect(declined).toMatchObject({ status: "declined", answeredBy: "Membre editor", photo: null, sound: null });
    expect(declined!.erasedAt!.getTime() - declined!.answeredAt!.getTime()).toBeGreaterThan(180 * 86_400_000);
    expect(await admin.moveApplication(depot.id, "new")).toEqual({ ok: true });
    expect(await admin.declineApplication(depot.id)).toEqual({ ok: true, keys: [], images: [] });
    const supprimee = await admin.deleteApplication(autre);
    expect(supprimee).toMatchObject({ name: "Autre", keys: [expect.stringMatching(/^audio\//)] });
    expect(await admin.deleteApplication(autre)).toBeNull();

    // La nuit : un dossier jamais envoyé, de plus d'un jour, part avec son son et sa photo ; un refus, après six mois.
    const perdu = await candidatures().ouvrirDossier(form({ instagram: "perdu", nom: "Perdu" }));
    if (!perdu.ok) throw new Error("dossier refusé");
    await candidatures().ajouterPhoto(perdu.jeton, image(6));
    const sonPerdu = await candidatures().preparerSon(perdu.jeton, { fileName: "set.mp3", size: 1000 });
    if (!sonPerdu.ok) throw new Error("son refusé");
    expect(await candidatures().menage()).toEqual({ abandoned: 0, erased: 0, keys: [], images: [] });
    clock = new Date(NOW.getTime() + 25 * 3600 * 1000);
    await db.update(application).set({ createdAt: sql`created_at - interval '25 hours'` }).where(eq(application.name, "Perdu"));
    const nuit = await candidatures().menage();
    expect(nuit).toMatchObject({ abandoned: 1, erased: 0, keys: [sonPerdu.key] });
    expect([...new Set(nuit.images)]).toEqual([image(6).key]);
    await db.update(application).set({ answeredAt: new Date("2026-04-01T10:00:00Z") }).where(eq(application.id, depot.id));
    expect(await candidatures().menage()).toMatchObject({ abandoned: 0, erased: 1 });
    expect(await db.select().from(application)).toEqual([]);
  });

  it("gardent leur cohérence dans la base : un contact, une réponse datée, un dossier ou un envoi", async () => {
    await reset();
    const base = { type: "dj_set" as const, name: "X", pitch: "Une idée assez longue." };
    expect((await pgError(db.insert(application).values({ ...base, submittedAt: NOW }))).message).toMatch(/application_contact/);
    expect((await pgError(db.insert(application).values({ ...base, email: "x@exemple.test", submittedAt: NOW, status: "accepted" }))).message).toMatch(/application_answered/);
    expect((await pgError(db.insert(application).values({ ...base, email: "x@exemple.test" }))).message).toMatch(/application_dossier/);
    expect((await pgError(db.insert(application).values({ ...base, email: "x@exemple.test", submittedAt: NOW, dossierHash: "abc" }))).message).toMatch(/application_dossier/);
  });
});
