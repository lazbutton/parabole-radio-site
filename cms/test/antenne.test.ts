/**
 * L'antenne libre (drizzle/0006_antenne.sql, 0007_antenne_acces.sql, src/chat/, src/admin/chat.ts) : les contrôles du
 * texte, l'envoi d'un auditeur et sa modération, l'historique, les signalements, les actions de la régie, la diffusion
 * par la base (le faux realtime.send() de local-supabase.ts note ce qui serait parti), les règles d'accès et la purge.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { withViewer } from "../src/access.ts";
import { createAdmin, type Admin } from "../src/admin/index.ts";
import { aDesCoordonnees, appliquerListe, essentiel, nettoyer, verifierForme, verifierFormePseudo, verifierLiens, type Terme } from "../src/chat/forme.ts";
import { createAntenne, type Antenne, type Envoi, type Issue } from "../src/chat/index.ts";
import type { Connection } from "../src/db.ts";
import { artist, chatAuthor, chatMessage, chatSettings, chatTerm } from "../src/schema.ts";
import { createAccount, exampleDb, pgError, rowsOf } from "./helpers.ts";

let connection: Connection;
let antenne: Antenne;
let regie: Admin;
let stranger: Admin;
let editorId: string;

beforeAll(async () => {
  connection = await exampleDb();
  antenne = createAntenne(connection.db);
  editorId = await createAccount(connection.db, "editor");
  regie = createAdmin(connection.db, editorId);
  stranger = createAdmin(connection.db, await createAccount(connection.db));
});
afterAll(() => connection?.close());

/** Chaque test part d'une antenne vide, aux réglages de départ. */
beforeEach(async () => {
  const { db } = connection;
  await db.delete(chatMessage);
  await db.delete(chatAuthor);
  await db.delete(chatTerm);
  await db.execute(sql`delete from public.chat_action`);
  await db.execute(sql`delete from private.chat_trace`);
  await db
    .update(chatSettings)
    .set({ open: true, slowSeconds: 0, delaySeconds: 0, careful: false, ticker: true, links: "music", reportThreshold: 3, clearedAt: null });
  await db.execute(sql`delete from realtime.messages`);
});

/** Ce que la base a diffusé sur le canal, dans l'ordre. */
async function diffuse(): Promise<{ topic: string; event: string; payload: Record<string, unknown> }[]> {
  return rowsOf(await connection.db.execute(sql`select topic, event, payload from realtime.messages order by id`));
}

const T0 = new Date("2026-11-02T20:00:00Z");
const plus = (secondes: number) => new Date(T0.getTime() + secondes * 1000);
let ip = 0;
/** Un envoi d'un auditeur, depuis sa propre adresse IP sauf mention contraire. */
const envoi = (pseudo: string, texte: string, fields: Partial<Envoi> = {}): Envoi => ({
  jeton: null,
  ip: `10.0.0.${++ip % 250}`,
  pseudo,
  couleur: "magenta",
  texte,
  maintenant: T0,
  ...fields,
});
/** Un envoi qui doit passer à l'antenne : son jeton, pour la suite. */
async function passe(e: Envoi): Promise<{ jeton: string; issue: Issue }> {
  const issue = await antenne.envoyer(e);
  if (issue.issue === "refuse") throw new Error(`refusé : ${issue.raison}`);
  return { jeton: issue.jeton ?? e.jeton!, issue };
}

describe("les contrôles du texte", () => {
  it("ramènent un mot déguisé à l'essentiel", () => {
    expect(essentiel("C0NN4RD")).toBe("conard");
    expect(essentiel("c.o.n.n.a.r.d")).toBe("conard");
    expect(essentiel("c o n n a r d !")).toBe("conard !");
    expect(essentiel("Éloïse")).toBe("eloise");
    expect(essentiel("trooop bien")).toBe("trop bien");
  });

  it("vérifient la forme : longueur, majuscules, émojis, répétitions, mentions", () => {
    expect(verifierForme("ce son est trop lourd")).toBeNull();
    expect(verifierForme("")).toMatch(/vide/);
    expect(verifierForme("a".repeat(161))).toMatch(/160/);
    expect(verifierForme("CE SON EST TROP LOURD ARRÊTEZ")).toMatch(/majuscules/);
    expect(verifierForme("PSG")).toBeNull();
    expect(verifierForme("🔥🔥🔥🔥🔥🔥🔥")).toMatch(/émojis/);
    expect(verifierForme("ouiiiiiiiiiiii")).toMatch(/répétées/);
    expect(verifierForme("@a @b @c @d")).toMatch(/mentions/);
    expect(nettoyer("  salut​ le‮ 18  ")).toBe("salut le 18");
  });

  it("repèrent les liens, même déguisés, et laissent passer ceux de la musique si la régie le permet", () => {
    expect(verifierLiens("écoute https://soundcloud.com/parabole-radio", "music")).toBeNull();
    expect(verifierLiens("mon son sur monsite point com", "music")).toMatch(/liens/);
    expect(verifierLiens("va sur bit . ly/xyz", "music")).toMatch(/liens/);
    expect(verifierLiens("www.arnaque.fr", "music")).toMatch(/liens/);
    expect(verifierLiens("https://soundcloud.com/x", "none")).toMatch(/liens/);
    expect(verifierLiens("https://exemple.fr", "all")).toBeNull();
    expect(verifierLiens("rendez-vous au point de départ", "music")).toBeNull();
  });

  it("repèrent les coordonnées, pas les années", () => {
    for (const texte of ["appelle le 06 12 34 56 78", "0612345678", "+33 6 12 34 56 78", "écris à moi@exemple.fr"]) expect(aDesCoordonnees(texte), texte).toBe(true);
    expect(aDesCoordonnees("les années 1997 2001 2005 2010")).toBe(false);
    expect(aDesCoordonnees("130 bpm")).toBe(false);
  });

  it("appliquent la liste de mots : en mot entier par défaut, le pire l'emporte, les mots masqués deviennent •••", () => {
    const termes: Terme[] = [
      { term: "con", action: "refuse", anywhere: false },
      { term: "boloss", action: "hold", anywhere: false },
      { term: "merde", action: "mask", anywhere: false },
    ];
    expect(appliquerListe("quel concert, quel conseil", termes).action).toBeNull();
    expect(appliquerListe("t'es c.o.n", termes).action).toBe("refuse");
    expect(appliquerListe("bande de b0l0ss", termes).action).toBe("hold");
    expect(appliquerListe("oh merde le son coupe", termes)).toEqual({ action: "mask", texte: "oh ••• le son coupe" });
    expect(appliquerListe("merde, quel boloss", termes).action).toBe("hold");
    expect(appliquerListe("superconnerie", [{ term: "con", action: "refuse", anywhere: true }]).action).toBe("refuse");
  });

  it("vérifient la forme d'un pseudo", () => {
    expect(verifierFormePseudo("lune_noire")).toBeNull();
    expect(verifierFormePseudo("Éloïse.75")).toBeNull();
    expect(verifierFormePseudo("ab")).toMatch(/3 à 20/);
    expect(verifierFormePseudo("dj lune")).toMatch(/3 à 20/);
    expect(verifierFormePseudo("Parabоle")).toMatch(/pas possible/); // un « о » cyrillique
  });
});

describe("envoyer : le pseudo, puis le message", () => {
  it("fait naître un pseudo, passe le message à l'antenne et le diffuse", async () => {
    const issue = await antenne.envoyer(envoi("lune_noire", "dédicace à tout le 18"));
    expect(issue).toMatchObject({ issue: "antenne", jeton: expect.any(String), message: { pseudo: "lune_noire", couleur: "magenta", texte: "dédicace à tout le 18", regie: false } });
    expect(await diffuse()).toEqual([
      { topic: "chat:antenne", event: "message", payload: expect.objectContaining({ pseudo: "lune_noire", texte: "dédicace à tout le 18", couleur: "magenta", regie: false }) },
    ]);
    expect((await antenne.historique({ maintenant: plus(1) })).map((m) => m.texte)).toEqual(["dédicace à tout le 18"]);
    // le jeton garde le pseudo : le message suivant vient du même auteur
    const second = await antenne.envoyer(envoi("lune_noire", "ça tabasse", { jeton: issue.jeton!, maintenant: plus(5) }));
    expect(second).toMatchObject({ issue: "antenne" });
    expect(second.jeton).toBeUndefined();
    expect(await connection.db.select().from(chatAuthor)).toHaveLength(1);
  });

  it("refuse un pseudo déjà pris, réservé ou au nom d'un artiste publié", async () => {
    await passe(envoi("kader75", "salut"));
    expect(await antenne.envoyer(envoi("KADER75", "moi aussi"))).toMatchObject({ issue: "refuse", code: "pseudo", raison: "ce pseudo est déjà pris." });
    expect(await antenne.envoyer(envoi("La_Regie", "coucou"))).toMatchObject({ issue: "refuse", code: "pseudo", raison: "ce pseudo est réservé." });
    await connection.db.insert(artist).values({ slug: "moodymann-test", name: "Moodymann", role: "guest", status: "published" });
    expect(await antenne.envoyer(envoi("moodymann", "c'est moi"))).toMatchObject({ issue: "refuse", code: "pseudo" });
  });

  it("change de pseudo trois fois par jour au plus ; un pseudo quitté reste réservé une semaine", async () => {
    const { jeton } = await passe(envoi("sam.b", "un"));
    for (const [n, pseudo] of ["sam.c", "sam.d", "sam.e"].entries()) await passe(envoi(pseudo, `message ${n}`, { jeton, maintenant: plus(60 * (n + 1)) }));
    expect(await antenne.envoyer(envoi("sam.f", "encore", { jeton, maintenant: plus(300) }))).toMatchObject({ issue: "refuse", code: "pseudo", raison: expect.stringMatching(/trois/) });
    expect(await antenne.envoyer(envoi("sam.b", "je le prends", { maintenant: plus(400) }))).toMatchObject({ issue: "refuse", raison: "ce pseudo est déjà pris." });
  });

  it("refuse et garde au journal les liens, les coordonnées et les propos interdits ; trois refus graves coupent l'antenne", async () => {
    await connection.db.insert(chatTerm).values({ term: "connard", action: "refuse" });
    const { jeton } = await passe(envoi("chateau.rouge", "bonsoir"));
    expect(await antenne.envoyer(envoi("chateau.rouge", "mon son : monsite point com", { jeton, maintenant: plus(10) }))).toMatchObject({ issue: "refuse", raison: expect.stringMatching(/liens/) });
    expect(await antenne.envoyer(envoi("chateau.rouge", "appelle le 06 12 34 56 78", { jeton, maintenant: plus(20) }))).toMatchObject({ raison: "pas de coordonnées à l'antenne." });
    expect(await antenne.envoyer(envoi("chateau.rouge", "t'es un c0nn4rd", { jeton, maintenant: plus(30) }))).toMatchObject({ raison: "propos interdits." });
    const troisieme = await antenne.envoyer(envoi("chateau.rouge", "c o n n a r d", { jeton, maintenant: plus(40) }));
    expect(troisieme).toMatchObject({ issue: "refuse", raison: expect.stringMatching(/^propos interdits\. Ton antenne est coupée jusqu'à 21 h 10\.$/) });
    expect(await antenne.envoyer(envoi("chateau.rouge", "pardon", { jeton, maintenant: plus(50) }))).toMatchObject({ issue: "refuse", code: "coupe" });
    const refuses = await connection.db.select({ status: chatMessage.status }).from(chatMessage);
    expect(refuses.filter((m) => m.status === "refused")).toHaveLength(4);
    // rien de tout cela n'est parti sur le canal
    expect((await diffuse()).map((d) => d.event)).toEqual(["message"]);
  });

  it("met en attente ce que la liste retient, et masque ce qu'elle masque", async () => {
    await connection.db.insert(chatTerm).values([
      { term: "boloss", action: "hold" },
      { term: "merde", action: "mask" },
    ]);
    expect(await antenne.envoyer(envoi("barbes4ever", "quel boloss celui-là"))).toMatchObject({ issue: "attente" });
    expect(await antenne.envoyer(envoi("simplon_fm", "oh merde ça coupe"))).toMatchObject({ issue: "antenne", message: { texte: "oh ••• ça coupe" } });
    expect((await diffuse()).map((d) => d.payload.texte)).toEqual(["oh ••• ça coupe"]);
  });

  it("respecte l'antenne fermée, le mode lent, le débit et les doublons", async () => {
    const { jeton } = await passe(envoi("mimi_goutte_dor", "un"));
    expect(await antenne.envoyer(envoi("mimi_goutte_dor", "un", { jeton, maintenant: plus(5) }))).toMatchObject({ raison: "message déjà envoyé." });
    for (let s = 1; s <= 4; s++) await passe(envoi("mimi_goutte_dor", `message ${s}`, { jeton, maintenant: plus(s) }));
    expect(await antenne.envoyer(envoi("mimi_goutte_dor", "le sixième", { jeton, maintenant: plus(6) }))).toMatchObject({ raison: expect.stringMatching(/^doucement/) });
    await connection.db.update(chatSettings).set({ slowSeconds: 10 });
    expect(await antenne.envoyer(envoi("mimi_goutte_dor", "plus tard", { jeton, maintenant: plus(40) }))).toMatchObject({ issue: "antenne" });
    expect(await antenne.envoyer(envoi("mimi_goutte_dor", "trop tôt", { jeton, maintenant: plus(45) }))).toMatchObject({ raison: "mode lent : réessaie dans 5 s." });
    await connection.db.update(chatSettings).set({ open: false });
    expect(await antenne.envoyer(envoi("mimi_goutte_dor", "ouvert ?", { jeton, maintenant: plus(100) }))).toMatchObject({ raison: "l'antenne est fermée." });
  });

  it("refuse plus de vingt messages par minute depuis une même adresse, tous pseudos confondus", async () => {
    for (let n = 0; n < 20; n++) await passe(envoi(`pseudo${String(n).padStart(2, "0")}`, `message ${n}`, { ip: "10.9.9.9", maintenant: plus(n) }));
    expect(await antenne.envoyer(envoi("pseudo99", "un de trop", { ip: "10.9.9.9", maintenant: plus(25) }))).toMatchObject({ raison: "doucement : réessaie dans une minute." });
  });

  it("en différé, le message passe plus tard : l'historique ne l'a pas avant son heure", async () => {
    await connection.db.update(chatSettings).set({ delaySeconds: 10 });
    const { issue } = await passe(envoi("lune_noire", "en différé"));
    expect(issue.issue === "antenne" && issue.message.antenne).toBe(plus(10).toISOString());
    expect(await antenne.historique({ maintenant: plus(5) })).toEqual([]);
    expect((await antenne.historique({ maintenant: plus(11) })).map((m) => m.texte)).toEqual(["en différé"]);
  });

  it("en mode prudent, les deux premiers messages d'un nouveau pseudo attendent la régie", async () => {
    await connection.db.update(chatSettings).set({ careful: true });
    const { jeton } = await passe(envoi("nouveau.venu", "bonjour"));
    expect(await antenne.envoyer(envoi("nouveau.venu", "c'est mon premier", { jeton, maintenant: plus(5) }))).toMatchObject({ issue: "attente" });
  });

  it("demande la vérification anti-robots à un nouveau pseudo seulement", async () => {
    let verifie = 0;
    const humain = async () => (verifie++, false);
    expect(await antenne.envoyer(envoi("robot42", "spam", { humain }))).toMatchObject({ issue: "refuse", code: "humain" });
    const { jeton } = await passe(envoi("humaine", "salut", { humain: async () => true }));
    await passe(envoi("humaine", "re", { jeton, humain, maintenant: plus(5) }));
    expect(verifie).toBe(1);
  });
});

describe("les signalements", () => {
  it("brouillent un message au seuil de la régie, et le retrait part sur le canal", async () => {
    const { issue } = await passe(envoi("chateau.rouge", "abonnez-vous à ma chaîne"));
    const id = issue.issue === "antenne" ? issue.message.id : "";
    expect(await antenne.signaler({ jeton: null, messageId: id, motif: "spam" })).toMatchObject({ ok: false });
    const jetons = await Promise.all(["temoin.a", "temoin.b", "temoin.c"].map(async (p) => (await passe(envoi(p, `je suis ${p}`))).jeton));
    for (const jeton of jetons.slice(0, 2)) expect(await antenne.signaler({ jeton, messageId: id, motif: "spam" })).toEqual({ ok: true });
    await antenne.signaler({ jeton: jetons[0]!, messageId: id, motif: "spam" }); // deux fois la même personne ne compte qu'une
    expect((await antenne.historique({ maintenant: plus(60) })).map((m) => m.id)).toContain(id);
    // la régie voit le message signalé, et combien de fois
    expect((await regie.antenne()).reported).toEqual([expect.objectContaining({ id, reports: 2, status: "visible" })]);
    await antenne.signaler({ jeton: jetons[2]!, messageId: id, motif: "spam" });
    expect((await antenne.historique({ maintenant: plus(60) })).map((m) => m.id)).not.toContain(id);
    expect((await diffuse()).at(-1)).toMatchObject({ event: "retrait", payload: { id } });
    // gardé par la régie : les signalements sont vus, il repasse si elle le publie
    expect(await regie.keepChatMessage(id)).toBe(true);
    expect((await regie.antenne()).reported).toEqual([]);
  });

  it("marquent le premier message d'un pseudo, pas les suivants", async () => {
    const { jeton } = await passe(envoi("premiere.fois", "un"));
    await passe(envoi("premiere.fois", "deux", { jeton, maintenant: plus(5) }));
    const vue = await regie.antenne();
    expect(vue.messages.map((m) => [m.body, m.first])).toEqual([
      ["deux", false],
      ["un", true],
    ]);
  });
});

describe("la régie", () => {
  it("retire un message, publie ou rejette un message en attente, garde un signalé", async () => {
    const { issue } = await passe(envoi("sam.b", "à retirer"));
    const id = issue.issue === "antenne" ? issue.message.id : "";
    expect(await regie.removeChatMessage(id)).toBe(true);
    expect(await regie.removeChatMessage(id)).toBe(false);
    expect((await diffuse()).at(-1)).toMatchObject({ event: "retrait", payload: { id } });

    await connection.db.insert(chatTerm).values({ term: "boloss", action: "hold" });
    const tenus = await Promise.all(["tenu.a", "tenu.b"].map((p) => antenne.envoyer(envoi(p, "quel boloss"))));
    const [a, b] = tenus.map((t) => (t.issue === "attente" ? t.message.id : ""));
    const vue = await regie.antenne();
    expect(vue.held.map((m) => m.id).sort()).toEqual([a, b].sort());
    expect(await regie.publishChatMessage(a!)).toBe(true);
    expect((await diffuse()).at(-1)).toMatchObject({ event: "message", payload: { id: a } });
    expect(await regie.rejectChatMessage(b!)).toBe(true);
    expect(await antenne.moi(null)).toBeNull();
    expect((await regie.antenne()).held).toEqual([]);
  });

  it("exclut et bannit : leurs messages récents brouillés, plus d'écriture, la même adresse refusée 24 h", async () => {
    const { jeton, issue } = await passe(envoi("fauteur", "premier message", { ip: "10.7.7.7", maintenant: new Date() }));
    const auteur = (await regie.antenne()).messages.find((m) => issue.issue === "antenne" && m.id === issue.message.id)!.authorId!;
    expect(await regie.muteChatAuthor(auteur, 7)).toBe(false); // pas un choix de l'écran
    expect(await regie.muteChatAuthor(auteur, 10)).toBe(true);
    expect((await diffuse()).at(-1)).toMatchObject({ event: "retrait" });
    expect(await antenne.envoyer(envoi("fauteur", "encore", { jeton, maintenant: new Date() }))).toMatchObject({ code: "coupe", raison: expect.stringMatching(/coupée jusqu'à/) });
    expect((await regie.antenne()).people.map((p) => p.id)).toEqual([auteur]);
    expect(await regie.liftChatAuthor(auteur)).toBe(true);
    expect(await regie.banChatAuthor(auteur, "insultes")).toBe(true);
    expect(await antenne.envoyer(envoi("fauteur", "encore", { jeton, maintenant: new Date() }))).toMatchObject({ code: "coupe", raison: "tu ne peux plus passer à l'antenne." });
    expect(await antenne.envoyer(envoi("autre.nom", "c'est pas moi", { ip: "10.7.7.7", maintenant: new Date() }))).toMatchObject({ code: "coupe" });
    expect(await antenne.envoyer(envoi("autre.nom", "c'est pas moi", { ip: "10.8.8.8", maintenant: new Date() }))).toMatchObject({ issue: "antenne" });
  });

  it("vide l'antenne et change ses réglages : le canal l'apprend, l'historique repart de zéro", async () => {
    await passe(envoi("lune_noire", "avant le vidage", { maintenant: new Date(Date.now() - 60_000) }));
    await regie.clearChat();
    const evenements = (await diffuse()).map((d) => d.event);
    expect(evenements.slice(-2)).toEqual(["vidage", "etat"]);
    expect(await antenne.historique()).toEqual([]);
    expect(await regie.saveChatSettings({ slowSeconds: 7 })).toMatchObject({ ok: false, errors: { slowSeconds: expect.any(String) } });
    expect(await regie.saveChatSettings({ open: false, delaySeconds: 10, ticker: false })).toEqual({ ok: true });
    expect((await diffuse()).at(-1)).toMatchObject({ event: "etat", payload: { ouvert: false, differe: 10, bandeau: false, lent: 0 } });
    expect(await antenne.etat()).toMatchObject({ ouvert: false, lent: 0, differe: 10, bandeau: false, liens: "music", vide: expect.any(String) });
  });

  it("tient la liste de mots, et écrit en tant que Parabole", async () => {
    const ajout = await regie.addChatTerm({ term: "  Boloss ", action: "hold", note: "insulte légère" });
    expect(ajout).toMatchObject({ ok: true });
    expect(await regie.addChatTerm({ term: "boloss", action: "refuse" })).toMatchObject({ ok: false, errors: { term: expect.any(String) } });
    expect(await regie.addChatTerm({ term: "x", action: "refuse" })).toMatchObject({ ok: false });
    expect(await regie.addChatTerm({ term: "truc", action: "effacer" })).toMatchObject({ ok: false, errors: { action: expect.any(String) } });
    expect((await regie.antenne()).terms).toEqual([{ id: expect.any(String), term: "boloss", action: "hold", anywhere: false, note: "insulte légère" }]);
    expect(await regie.removeChatTerm(ajout.ok ? ajout.id : "")).toBe("boloss");
    expect(await regie.postAsTeam("Tracklist dans 5 min !")).toMatchObject({ ok: true });
    expect((await diffuse()).at(-1)).toMatchObject({ event: "message", payload: { regie: true, pseudo: "Parabole", texte: "Tracklist dans 5 min !" } });
  });
});

describe("les règles d'accès", () => {
  it("ne laissent rien lire au public, et rien à un compte hors de l'équipe", async () => {
    await passe(envoi("lune_noire", "secret ?"));
    expect(await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.select().from(chatMessage)))).toMatchObject({ code: "42501" });
    expect(await pgError(withViewer(connection.db, { role: "anon" }, (tx) => tx.execute(sql`select * from private.chat_trace`)))).toMatchObject({ code: "42501" });
    expect((await stranger.antenne()).messages).toEqual([]);
    expect(await stranger.removeChatMessage((await regie.antenne()).messages[0]!.id)).toBe(false);
    expect((await regie.antenne()).messages).toHaveLength(1);
  });

  it("gardent la trace de l'adresse IP de chaque message, et la purge fait le ménage", async () => {
    await passe(envoi("vieux.pseudo", "il y a longtemps", { ip: "10.1.2.3", maintenant: new Date("2025-01-01T12:00:00Z") }));
    const [trace] = rowsOf<{ ip: string }>(await connection.db.execute(sql`select host(ip) as ip from private.chat_trace`));
    expect(trace?.ip).toBe("10.1.2.3");
    await connection.db.execute(sql`select private.purge_chat()`);
    expect(await connection.db.select().from(chatMessage)).toEqual([]);
    expect(await connection.db.select().from(chatAuthor)).toEqual([]);
    expect(rowsOf(await connection.db.execute(sql`select * from private.chat_trace`))).toEqual([]);
  });
});
