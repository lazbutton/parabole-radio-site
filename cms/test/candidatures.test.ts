/**
 * Les candidatures (src/candidatures/, src/admin/candidatures.ts) : les règles de la saisie, partagées avec la page ;
 * le dossier de l'envoi (ouvert après Turnstile, mis à jour, refusé si le type est complet, si la personne a déjà une
 * candidature en cours, ou au-delà du plafond par heure) ; le son déposé dans le seau, la photo, l'envoi ; les règles
 * d'accès ; ce que l'équipe en fait (la liste, noter, mettre de côté, valider, qui crée la fiche d'invité et l'émission
 * avec son son validé, ou reprend la fiche du même nom sans rien écraser ; « Pas cette fois », qui efface tout de
 * suite la candidature, son son et sa photo ; l'effacement) ; les réglages ; ce que compte l'accueil ; et le ménage de
 * la nuit (les dossiers abandonnés, les candidatures validées depuis six mois, les refus d'avant le 11 nov. 2026).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin, UPLOAD_FOLDER } from "../src/admin/index.ts";
import { createCandidatures } from "../src/candidatures/index.ts";
import { adresseWeb, compteInsta, ecrireMorceaux, lireCandidature, lireDossier, lireEnvoi, lireMorceaux, type CandidatureForm } from "../src/candidatures/regles.ts";
import type { Connection, Db } from "../src/db.ts";
import { application, applicationSettings, applicationTag, artist, artistTag, audioFile, media, show, showArtist, showTag, submission, tag, track } from "../src/schema.ts";
import { createAccount, freshDb, pgError } from "./helpers.ts";

const NOW = new Date("2026-11-06T10:00:00Z");

/** Une candidature complète de DJ, à varier. */
const form = (changes: Partial<CandidatureForm> = {}): CandidatureForm => ({
  type: "dj_set",
  titre: "Disco du dimanche",
  description: "Un set house et disco du dimanche, avec des raretés funk.",
  styles: [],
  nom: "Lou Velours",
  bio: "DJ à Lyon, je mixe de la house et du disco depuis dix ans.",
  ville: "Lyon",
  instagram: "@lou.velours",
  profil: "",
  email: "",
  lien: "",
  tracklist: "Artiste Un\tTitre un",
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
      title: "Disco du dimanche",
      pitch: "Un set house et disco du dimanche, avec des raretés funk.",
      styles: ["house", "jazz", "rock"],
      name: "Lou Velours",
      bio: "DJ à Lyon, je mixe de la house et du disco depuis dix ans.",
      city: "Lyon",
      instagram: "lou.velours",
      profileUrl: null,
      email: null,
    });
    expect(lireDossier(form({ profil: "soundcloud.com/lou-velours" })).values?.profileUrl).toBe("https://soundcloud.com/lou-velours");
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
    expect(lireDossier(form({ instagram: "lou velours", email: "lou@", profil: "pas un lien" })).errors).toEqual({
      instagram: "Ce compte n'a pas l'air juste : des lettres, des chiffres, des points et des _ seulement.",
      profil: "Ce lien n'a pas l'air d'une adresse web.",
      email: "Cette adresse e-mail n'a pas l'air complète.",
    });
  });

  it("demandent le MP3, ou pour une playlist son lien ; le mot reste facultatif", () => {
    expect(lireEnvoi(form(), { aSon: false }).errors).toEqual({ son: "Ajoute le MP3 de ton émission." });
    expect(lireEnvoi(form({ type: "playlist" }), { aSon: false }).errors).toEqual({ son: "Ajoute le MP3 de ta playlist, ou son lien." });
    expect(lireEnvoi(form({ type: "playlist", lien: "pas un lien" }), { aSon: false }).errors).toEqual({ lien: "Ce lien n'a pas l'air d'une adresse web." });
    expect(lireEnvoi(form({ type: "playlist", lien: "deezer.com/playlist/1" }), { aSon: false }).values).toEqual({
      listenUrl: "https://deezer.com/playlist/1",
      tracklist: "Artiste Un\tTitre un",
      message: null,
    });
    // Un set n'envoie pas de lien, même s'il en reste un dans le brouillon.
    expect(lireEnvoi(form({ lien: "deezer.com/x", message: " Merci ! " }), { aSon: true }).values).toEqual({ listenUrl: null, tracklist: "Artiste Un\tTitre un", message: "Merci !" });
    expect(lireCandidature(form({ titre: "" }), { aSon: false }).errors).toEqual({ titre: "Donne un titre à ton émission.", son: "Ajoute le MP3 de ton émission." });
  });

  it("demandent la tracklist en cases (l'artiste et le titre) pour un DJ set et une playlist, pas pour un podcast", () => {
    const manque = "Ajoute ta tracklist : l'artiste et le titre de chaque morceau.";
    expect(lireEnvoi(form({ tracklist: "" }), { aSon: true }).errors).toEqual({ tracklist: manque });
    expect(lireEnvoi(form({ type: "playlist", tracklist: "\t\n  \t " }), { aSon: true }).errors).toEqual({ tracklist: manque });
    expect(lireEnvoi(form({ type: "podcast", tracklist: "" }), { aSon: true }).values).toEqual({ listenUrl: null, tracklist: null, message: null });
    // Une ligne à moitié remplie : il manque une case.
    expect(lireEnvoi(form({ tracklist: "Artiste Un\tTitre un\nArtiste seul\t" }), { aSon: true }).errors).toEqual({
      tracklist: "Il manque l'artiste ou le titre d'un morceau : remplis les deux cases, ou retire la ligne.",
    });
    expect(lireEnvoi(form({ type: "podcast", tracklist: "\tTitre seul" }), { aSon: true }).errors.tracklist).toMatch(/Il manque/);
    // Les cases sont remises au propre ; les lignes vides, oubliées.
    expect(lireEnvoi(form({ tracklist: "  Jay-Z \t  Dirt  off your   shoulder \n\t\n Moodymann\tShades of Jae" }), { aSon: true }).values?.tracklist).toBe(
      "Jay-Z\tDirt off your shoulder\nMoodymann\tShades of Jae",
    );
    expect(lireEnvoi(form({ tracklist: Array.from({ length: 301 }, (_, n) => `A${n}\tT${n}`).join("\n") }), { aSon: true }).errors.tracklist).toMatch(/300 au plus/);
  });

  it("lisent et écrivent les morceaux, et une tracklist collée d'avant les cases", () => {
    expect(lireMorceaux("00:00 Artiste – Titre\n12:30 Autre - Morceau (Remix)\n\nTracklist :")).toEqual([
      { artiste: "Artiste", titre: "Titre" },
      { artiste: "Autre", titre: "Morceau (Remix)" },
    ]);
    expect(lireMorceaux("Titre sans artiste")).toEqual([{ artiste: "", titre: "Titre sans artiste" }]);
    const morceaux = [
      { artiste: "Jay-Z", titre: "Dirt Off Your Shoulder" },
      { artiste: "Kate Bush", titre: "Running Up That Hill – 2018 Remaster" },
    ];
    expect(lireMorceaux(ecrireMorceaux(morceaux))).toEqual(morceaux);
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
    await db.update(applicationSettings).set({ openTypes: ["dj_set", "podcast", "playlist"] });
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
    expect(await candidatures().reglages()).toEqual({ openTypes: ["dj_set", "podcast", "playlist"] });
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
    const depot = await candidatures().deposer(ouvert.jeton, form({ titre: "Disco du lundi", styles: [genre!.slug], tracklist: "A\tB", profil: "soundcloud.com/lou" }), {
      id: second.id,
      size: 140_000_000,
    });
    expect(depot).toMatchObject({ ok: true, removedKeys: [] });
    const [envoyee] = await db.select().from(application);
    expect(envoyee).toMatchObject({ dossierHash: null, tracklist: "A\tB", profileUrl: "https://soundcloud.com/lou", status: "new", regular: null });
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
    expect(await createAdmin(db, editorId).saveApplicationSettings({ openTypes: ["podcast"] })).toEqual({ ok: false, errors: { form: "Seul un admin règle les candidatures." } });
    expect(await createAdmin(db, adminId).saveApplicationSettings({ openTypes: ["podcast", "inconnu"] })).toEqual({ ok: true });
    expect(await createAdmin(db, editorId).applicationSettings()).toEqual({ openTypes: ["podcast"] });
  });

  it("se listent une fois envoyées seulement, par statut, type et recherche ; l'accueil les compte", async () => {
    await reset();
    await envoyer();
    await envoyer({ type: "podcast", instagram: "", email: "ondes@exemple.test", nom: "Les Ondes Courtes", titre: "Radio pirate" });
    await envoyer({ instagram: "ancienne", nom: "Ancienne", titre: "Vieux set" });
    await db.update(application).set({ submittedAt: new Date("2026-10-01T10:00:00Z") }).where(eq(application.instagram, "ancienne"));
    // Un dossier pas encore envoyé n'existe pas pour l'équipe.
    await candidatures().ouvrirDossier(form({ instagram: "en.cours", nom: "En cours" }));
    const admin = createAdmin(db, editorId);
    expect((await admin.listApplications({})).rows.map((row) => [row.name, row.title, row.hasSound])).toEqual([
      ["Les Ondes Courtes", "Radio pirate", true],
      ["Lou Velours", "Disco du dimanche", true],
      ["Ancienne", "Vieux set", true],
    ]);
    expect((await admin.listApplications({ type: "podcast" })).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes"]);
    expect((await admin.listApplications({ q: "pirate" })).rows.map((row) => row.name)).toEqual(["Les Ondes Courtes"]);
    expect((await admin.listApplications({})).counts).toEqual({ new: 3, shortlisted: 0, accepted: 0, declined: 0 });
    expect(await admin.applicationCounts()).toEqual({ new: 3, shortlisted: 0 });
  });

  it("se valident : la fiche d'invité, l'émission en brouillon, ses styles, sa tracklist, l'envoi et le son validé", async () => {
    await reset();
    const [genre] = (await candidatures().styles())[0]!.groupes;
    const ouvert = await candidatures().ouvrirDossier(form({ styles: [genre!.slug] }));
    if (!ouvert.ok) throw new Error("dossier refusé");
    const photo = await candidatures().ajouterPhoto(ouvert.jeton, image(4));
    const son = await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: 1000 });
    if (!photo.ok || !son.ok) throw new Error("refusé");
    const depot = await candidatures().deposer(
      ouvert.jeton,
      form({ styles: [genre!.slug], tracklist: "Artiste Un\tTitre un\nArtiste Deux\tTitre deux", message: "Merci !", profil: "https://soundcloud.com/lou-velours" }),
      { id: son.id, size: 1000 },
    );
    if (!depot.ok) throw new Error("envoi refusé");
    const admin = createAdmin(db, editorId);
    expect(await admin.moveApplication(depot.id, "shortlisted")).toEqual({ ok: true });
    expect(await admin.noteApplication(depot.id, "  À placer un dimanche  ")).toEqual({ ok: true });
    expect(await admin.getApplication(depot.id)).toMatchObject({
      status: "shortlisted",
      profileUrl: "https://soundcloud.com/lou-velours",
      erasedAt: null,
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
      links: [
        { label: "Instagram", url: "https://www.instagram.com/lou.velours/" },
        { label: "SoundCloud", url: "https://soundcloud.com/lou-velours" },
      ],
    });
    const activite = await db.select({ slug: tag.slug }).from(artistTag).innerJoin(tag, eq(tag.id, artistTag.tagId)).where(eq(artistTag.artistId, accepted.artistId));
    expect(activite.map((one) => one.slug)).toEqual(["dj"]);
    const [emission] = await db.select().from(show).where(eq(show.id, accepted.showId));
    expect(emission).toMatchObject({ title: "Disco du dimanche", slug: "disco-du-dimanche", type: "dj_set", status: "draft", description: "Un set house et disco du dimanche, avec des raretés funk.", broadcastAt: null });
    expect(await db.select({ artistId: showArtist.artistId }).from(showArtist).where(eq(showArtist.showId, accepted.showId))).toEqual([{ artistId: accepted.artistId }]);
    expect((await db.select({ slug: tag.slug }).from(showTag).innerJoin(tag, eq(tag.id, showTag.tagId)).where(eq(showTag.showId, accepted.showId))).map((one) => one.slug)).toEqual([genre!.slug]);
    expect(await db.select({ position: track.position, artist: track.artist, title: track.title, start: track.startSeconds }).from(track).where(eq(track.showId, accepted.showId)).orderBy(track.position)).toEqual([
      { position: 1, artist: "Artiste Un", title: "Titre un", start: null },
      { position: 2, artist: "Artiste Deux", title: "Titre deux", start: null },
    ]);
    expect(await db.select({ artistId: submission.artistId, note: submission.note, link: submission.link }).from(submission).where(eq(submission.showId, accepted.showId))).toEqual([
      { artistId: accepted.artistId, note: "Merci !", link: null },
    ]);
    expect(await db.select({ showId: audioFile.showId, applicationId: audioFile.applicationId, status: audioFile.status }).from(audioFile)).toEqual([
      { showId: accepted.showId, applicationId: null, status: "approved" },
    ]);
    const validee = await admin.getApplication(depot.id);
    // Effacée six mois après la validation.
    expect(validee!.erasedAt!.getTime() - validee!.answeredAt!.getTime()).toBeGreaterThan(180 * 86_400_000);
    expect(validee).toMatchObject({
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
    const id = await envoyer({
      type: "podcast",
      instagram: "",
      email: "ondes@exemple.test",
      profil: "mixcloud.com/ondes",
      nom: "les ondes courtes",
      titre: "Radio pirate",
      bio: "Une bio inventée pour prendre leur place.",
      tracklist: "",
    });
    const admin = createAdmin(db, editorId);
    expect((await admin.getApplication(id))?.sameName).toEqual({ id: existante!.id, name: "Les Ondes Courtes" });
    const accepted = await admin.acceptApplication(id);
    expect(accepted).toMatchObject({ ok: true, artistId: existante!.id, reused: true });
    // Sa bio reste ; ses liens manquaient : ils viennent de la candidature.
    const [fiche] = await db.select({ role: artist.role, bio: artist.bio, links: artist.links }).from(artist).where(eq(artist.id, existante!.id));
    expect(fiche).toEqual({ role: "resident", bio: "Leur vraie bio.", links: [{ label: "Mixcloud", url: "https://mixcloud.com/ondes" }] });
    // Une fiche qui a déjà ses liens les garde.
    await db.update(artist).set({ links: [{ label: "Site", url: "https://ondes.exemple.test" }] }).where(eq(artist.id, existante!.id));
    const encore = await envoyer({ type: "podcast", instagram: "ondes", email: "", profil: "soundcloud.com/ondes", nom: "Les Ondes Courtes", titre: "Radio pirate 2", tracklist: "" });
    expect(await admin.acceptApplication(encore)).toMatchObject({ ok: true, artistId: existante!.id });
    expect((await db.select({ links: artist.links }).from(artist).where(eq(artist.id, existante!.id)))[0]!.links).toEqual([{ label: "Site", url: "https://ondes.exemple.test" }]);
    expect(await db.select({ id: artist.id }).from(artist).where(sql`lower(${artist.name}) = 'les ondes courtes'`)).toHaveLength(1);
    // Une candidature d'avant le son, sans lien : rien à valider.
    await db.insert(application).values({ type: "dj_set", name: "Ancien", pitch: "Une idée assez longue pour passer.", instagram: "ancien", submittedAt: NOW });
    const [ancienne] = await db.select({ id: application.id }).from(application).where(eq(application.name, "Ancien"));
    expect(await admin.acceptApplication(ancienne!.id)).toMatchObject({ ok: false, errors: { form: expect.stringMatching(/rien à valider/) } });
  });

  it("« Pas cette fois » les efface tout de suite, avec leur son et leur photo ; elles s'effacent aussi à la main", async () => {
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
    expect(await admin.moveApplication(depot.id, "shortlisted")).toEqual({ ok: true });
    const refus = await admin.declineApplication(depot.id);
    expect(refus).toMatchObject({ ok: true, name: "Lou Velours", keys: [son.key] });
    if (refus.ok) expect([...new Set(refus.images)]).toEqual([image(5).key]);
    expect(await admin.getApplication(depot.id)).toBeNull();
    expect(await db.select().from(audioFile).where(eq(audioFile.applicationId, depot.id))).toEqual([]);
    expect(await db.select({ id: media.id }).from(media).where(eq(media.key, image(5).key))).toEqual([]);
    expect(await admin.declineApplication(depot.id)).toMatchObject({ ok: false });
    // Effacée, la même personne peut en envoyer une autre.
    expect((await candidatures().ouvrirDossier(form())).ok).toBe(true);
    const supprimee = await admin.deleteApplication(autre);
    expect(supprimee).toMatchObject({ name: "Autre", keys: [expect.stringMatching(/^audio\//)] });
    expect(await admin.deleteApplication(autre)).toBeNull();
  });

  it("la nuit, oublient les dossiers abandonnés, les validées depuis six mois (l'émission et la fiche restent) et les vieux refus", async () => {
    await reset();
    // Une candidature validée, avec sa photo, qui passe à la fiche.
    const ouvert = await candidatures().ouvrirDossier(form());
    if (!ouvert.ok) throw new Error("dossier refusé");
    const photo = await candidatures().ajouterPhoto(ouvert.jeton, image(7));
    const son = await candidatures().preparerSon(ouvert.jeton, { fileName: "set.mp3", size: 1000 });
    if (!photo.ok || !son.ok) throw new Error("refusé");
    const depot = await candidatures().deposer(ouvert.jeton, form(), { id: son.id, size: 1000 });
    if (!depot.ok) throw new Error("envoi refusé");
    const accepted = await createAdmin(db, editorId).acceptApplication(depot.id);
    if (!accepted.ok) throw new Error("validation refusée");
    // Un refus d'avant le 11 nov. 2026, gardé à l'époque.
    await db.insert(application).values({ type: "dj_set", name: "Refus", pitch: "Une idée assez longue pour passer.", instagram: "refus", submittedAt: NOW, status: "declined", answeredAt: NOW });
    // Un dossier jamais envoyé.
    const perdu = await candidatures().ouvrirDossier(form({ instagram: "perdu", nom: "Perdu" }));
    if (!perdu.ok) throw new Error("dossier refusé");
    await candidatures().ajouterPhoto(perdu.jeton, image(6));
    const sonPerdu = await candidatures().preparerSon(perdu.jeton, { fileName: "set.mp3", size: 1000 });
    if (!sonPerdu.ok) throw new Error("son refusé");

    // Cette nuit : le vieux refus part ; le dossier n'a pas un jour, la validée pas six mois.
    expect(await candidatures().menage()).toEqual({ abandoned: 0, erased: 1, keys: [], images: [] });
    // (created_at et answered_at sont l'heure réelle de l'écriture : la date du test s'y règle.)
    await db.update(application).set({ createdAt: new Date(NOW.getTime() - 25 * 3600 * 1000) }).where(eq(application.name, "Perdu"));
    const nuit = await candidatures().menage();
    expect(nuit).toMatchObject({ abandoned: 1, erased: 0, keys: [sonPerdu.key] });
    expect([...new Set(nuit.images)]).toEqual([image(6).key]);
    expect(await db.select({ id: application.id }).from(application)).toEqual([{ id: depot.id }]);

    // Six mois et un jour après la validation : la candidature part ; l'émission, la fiche, sa photo et le son restent.
    await db.update(application).set({ answeredAt: new Date("2026-05-05T10:00:00Z") }).where(eq(application.id, depot.id));
    expect(await candidatures().menage()).toEqual({ abandoned: 0, erased: 1, keys: [], images: [] });
    expect(await db.select().from(application)).toEqual([]);
    expect(await db.select({ id: show.id }).from(show)).toEqual([{ id: accepted.showId }]);
    expect(await db.select({ photoId: artist.photoId }).from(artist)).toEqual([{ photoId: photo.media.id }]);
    expect(await db.select({ id: audioFile.id, showId: audioFile.showId }).from(audioFile)).toEqual([{ id: son.id, showId: accepted.showId }]);
  });

  it("gardent leur cohérence dans la base : un contact, une réponse datée, un dossier ou un envoi", async () => {
    await reset();
    const base = { type: "dj_set" as const, name: "X", pitch: "Une idée assez longue." };
    expect((await pgError(db.insert(application).values({ ...base, submittedAt: NOW }))).message).toMatch(/application_contact/);
    expect((await pgError(db.insert(application).values({ ...base, email: "x@exemple.test", submittedAt: NOW, status: "accepted" }))).message).toMatch(/application_answered/);
    // Écrite d'un coup, comme par la première version de la page : envoyée, à l'heure de l'écriture.
    const [ecrite] = await db.insert(application).values({ ...base, email: "x@exemple.test" }).returning({ submittedAt: application.submittedAt });
    expect(ecrite!.submittedAt).toBeInstanceOf(Date);
    // Un dossier n'est pas encore envoyé ; une candidature envoyée n'a plus de dossier.
    expect((await pgError(db.insert(application).values({ ...base, email: "y@exemple.test", dossierHash: "abc" }))).message).toMatch(/application_dossier/);
    expect((await pgError(db.insert(application).values({ ...base, email: "y@exemple.test", submittedAt: null }))).message).toMatch(/application_dossier/);
    expect((await pgError(db.insert(application).values({ ...base, email: "y@exemple.test", submittedAt: NOW, dossierHash: "abc" }))).message).toMatch(/application_dossier/);
  });
});
