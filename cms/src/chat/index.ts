/**
 * L'antenne libre, côté serveur (CHAT_EN_DIRECT.md) : ce que lit tout le monde (l'état de l'antenne, l'historique), et ce
 * qu'un auditeur envoie, son pseudo puis son message, passé par la modération (section 4.2) avant d'exister pour les
 * autres. Tout se fait avec la connexion du serveur, en propriétaire des tables : le public n'y a aucun droit
 * (0010_antenne_acces.sql). La base diffuse elle-même ce qui passe à l'antenne.
 *
 * L'auditeur n'a pas de compte : une session anonyme, un jeton dans un cookie que le site pose, dont la base ne garde
 * que l'empreinte.
 *
 *   const antenne = createAntenne(db);
 *   const issue = await antenne.envoyer({ jeton, ip, pseudo: "lune_noire", couleur: "magenta", texte: "dédicace au 18" });
 */
import { createHash, randomBytes } from "node:crypto";
import { and, count, countDistinct, desc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../db.ts";
import { STATION_TIME_ZONE } from "../paris.ts";
import { artist, chatAction, chatAuthor, chatMessage, chatReport, chatSettings, chatTerm, type ChatAuthor, type ChatColor, type ChatSettings } from "../schema.ts";
import { aDesCoordonnees, appliquerListe, cleDePseudo, essentiel, nettoyer, NOMS_RESERVES, verifierForme, verifierFormePseudo, verifierLiens } from "./forme.ts";

/** Ce que tout le monde sait de l'antenne : la page 888 et le bandeau s'y règlent. */
export type EtatAntenne = {
  ouvert: boolean;
  lent: number;
  differe: number;
  bandeau: boolean;
  liens: ChatSettings["links"];
  /** Le dernier vidage : la page qui l'a manqué (une coupure) vide son fil en le voyant changer. */
  vide: string | null;
};

/** Un message tel qu'il part vers les navigateurs : ni adresse IP, ni identifiant d'auteur. */
export type MessageAntenne = { id: string; pseudo: string; couleur: ChatColor; texte: string; regie: boolean; heure: string; antenne: string };

export type Envoi = {
  /** Le jeton du cookie, s'il y en a un. */
  jeton: string | null;
  ip: string | null;
  pseudo: string;
  couleur: ChatColor;
  texte: string;
  /** Pour un nouveau pseudo : la vérification anti-robots (Turnstile), si le site en a une. */
  humain?: () => Promise<boolean>;
  maintenant?: Date;
};

/**
 * L'issue d'un envoi. `jeton` : un nouveau pseudo vient de naître, le site pose ce jeton dans son cookie (même si le
 * message, lui, est refusé). `code` : pseudo (à corriger), humain (la vérification anti-robots), coupe (exclusion ou
 * bannissement).
 */
export type Issue =
  | { issue: "antenne" | "attente"; message: MessageAntenne; jeton?: string }
  | { issue: "refuse"; raison: string; code?: "pseudo" | "humain" | "coupe"; jeton?: string };

/** Ce qu'un auditeur sait de lui-même : son pseudo, une exclusion ou un bannissement, ses derniers messages. */
export type Moi = {
  pseudo: string;
  couleur: ChatColor;
  exclusion: string | null;
  banni: boolean;
  messages: { id: string; statut: "antenne" | "attente" | "refuse" | "brouille"; raison: string | null }[];
};

const SECONDE = 1000;
const MINUTE = 60 * SECONDE;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;
const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");
const heureDeParis = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const aParis = (quand: Date) => heureDeParis.format(quand).replace(":", " h ");
/** Les lignes d'un tx.execute() : PGlite les range dans « rows », postgres-js les rend directement. */
const lignes = <T>(resultat: unknown): T[] => (Array.isArray(resultat) ? resultat : (resultat as { rows: T[] }).rows);

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const colonnesPubliques = {
  id: chatMessage.id,
  pseudo: chatMessage.pseudo,
  color: chatMessage.color,
  body: chatMessage.body,
  memberId: chatMessage.memberId,
  createdAt: chatMessage.createdAt,
  onAirAt: chatMessage.onAirAt,
};
export const messagePublic = (m: { id: string; pseudo: string; color: ChatColor; body: string; memberId: string | null; createdAt: Date; onAirAt: Date }): MessageAntenne => ({
  id: m.id,
  pseudo: m.pseudo,
  couleur: m.color,
  texte: m.body,
  regie: m.memberId !== null,
  heure: m.createdAt.toISOString(),
  antenne: m.onAirAt.toISOString(),
});

const PAR_DEFAUT: ChatSettings = {
  id: true,
  open: true,
  slowSeconds: 0,
  delaySeconds: 0,
  careful: false,
  ticker: true,
  links: "music",
  reportThreshold: 3,
  clearedAt: null,
  updatedBy: null,
  updatedAt: new Date(0),
};
async function lireReglages(tx: Db | Tx): Promise<ChatSettings> {
  const [reglages] = await tx.select().from(chatSettings).limit(1);
  return reglages ?? PAR_DEFAUT;
}
const etatDe = (r: ChatSettings): EtatAntenne => ({
  ouvert: r.open,
  lent: r.slowSeconds,
  differe: r.delaySeconds,
  bandeau: r.ticker,
  liens: r.links,
  vide: r.clearedAt?.toISOString() ?? null,
});

async function auteurDuJeton(tx: Db | Tx, jeton: string): Promise<ChatAuthor | null> {
  const [auteur] = await tx.select().from(chatAuthor).where(eq(chatAuthor.tokenHash, empreinte(jeton))).limit(1);
  return auteur ?? null;
}

/** Une décision des règles, au journal, à l'heure de l'envoi. */
const journal = (tx: Tx, quand: Date, action: string, messageId: string | null, authorId: string | null, details: Record<string, unknown> = {}) =>
  tx.insert(chatAction).values({ actor: "rules", action, messageId, authorId, details, createdAt: quand });

/** Le pseudo est-il libre ? La raison d'un refus, ou null. */
async function pseudoPris(tx: Tx, pseudo: string, cle: string, auteurId: string | null, maintenant: Date): Promise<string | null> {
  // ramené à l'essentiel, « Paraaab0le » se lit aussi « parabole »
  const reduit = essentiel(pseudo).replace(/[^\p{L}\p{N}]/gu, "");
  if ([cle, reduit].some((forme) => NOMS_RESERVES.includes(forme) || forme.includes("parabole") || forme.includes("regie"))) return "ce pseudo est réservé.";
  const artistes = await tx.select({ name: artist.name }).from(artist).where(eq(artist.status, "published"));
  if (artistes.some((a) => cleDePseudo(a.name) === cle)) return "ce pseudo est réservé : c'est le nom d'un artiste de Parabole.";
  const termes = await tx.select({ term: chatTerm.term, action: chatTerm.action, anywhere: chatTerm.anywhere }).from(chatTerm);
  if (appliquerListe(pseudo, termes).action) return "ce pseudo n'est pas possible.";
  const [autre] = await tx
    .select({ id: chatAuthor.id })
    .from(chatAuthor)
    .where(and(eq(chatAuthor.pseudoKey, cle), auteurId ? ne(chatAuthor.id, auteurId) : undefined))
    .limit(1);
  if (autre) return "ce pseudo est déjà pris.";
  // un pseudo quitté reste à son ancien porteur une semaine
  const [quitte] = await tx
    .select({ id: chatAction.id })
    .from(chatAction)
    .where(
      and(
        eq(chatAction.action, "rename"),
        sql`${chatAction.details}->>'avant' = ${cle}`,
        gt(chatAction.createdAt, new Date(maintenant.getTime() - 7 * JOUR)),
        auteurId ? ne(chatAction.authorId, auteurId) : undefined,
      ),
    )
    .limit(1);
  return quitte ? "ce pseudo est déjà pris." : null;
}

/** Un auditeur banni depuis cette adresse IP, il y a moins de 24 heures ? */
async function ipBannie(tx: Tx, ip: string, maintenant: Date): Promise<boolean> {
  const depuis = new Date(maintenant.getTime() - JOUR);
  const [ligne] = lignes<{ n: number }>(
    await tx.execute(sql`select count(*)::int as n from private.chat_trace t join public.chat_author a on a.id = t.author_id
      where t.ip = ${ip}::inet and a.banned_at is not null and a.banned_at > ${depuis.toISOString()}::timestamptz`),
  );
  return (ligne?.n ?? 0) > 0;
}

/** Changer de pseudo ou de couleur : trois changements de pseudo par jour au plus. L'auteur à jour, ou la raison d'un refus. */
async function renommer(tx: Tx, auteur: ChatAuthor, pseudo: string, couleur: ChatColor, maintenant: Date): Promise<ChatAuthor | string> {
  const cle = cleDePseudo(pseudo);
  if (cle !== auteur.pseudoKey) {
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(chatAction)
      .where(and(eq(chatAction.authorId, auteur.id), eq(chatAction.action, "rename"), gt(chatAction.createdAt, new Date(maintenant.getTime() - JOUR))));
    if (n >= 3) return "trois changements de pseudo par jour au plus.";
    const pris = await pseudoPris(tx, pseudo, cle, auteur.id, maintenant);
    if (pris) return pris;
    await journal(tx, maintenant, "rename", null, auteur.id, { avant: auteur.pseudoKey, apres: cle, pseudo });
  }
  const [mis] = await tx.update(chatAuthor).set({ pseudo, pseudoKey: cle, color: couleur }).where(eq(chatAuthor.id, auteur.id)).returning();
  return mis ?? auteur;
}

/** Les refus qui, répétés, coupent l'antenne de leur auteur (étape 10). */
const GRAVES = ["propos", "coordonnees"];

/**
 * Trois refus graves en dix minutes : l'antenne de l'auteur est coupée dix minutes, une heure la deuxième fois de la
 * journée. L'heure de fin, ou null.
 */
async function sanctionner(tx: Tx, auteur: ChatAuthor, maintenant: Date): Promise<Date | null> {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(chatAction)
    .where(
      and(
        eq(chatAction.authorId, auteur.id),
        eq(chatAction.action, "refuse"),
        sql`${chatAction.details}->>'categorie' in ('propos', 'coordonnees')`,
        gt(chatAction.createdAt, new Date(maintenant.getTime() - 10 * MINUTE)),
      ),
    );
  if (n < 3) return null;
  const [{ deja } = { deja: 0 }] = await tx
    .select({ deja: count() })
    .from(chatAction)
    .where(and(eq(chatAction.authorId, auteur.id), eq(chatAction.action, "mute_auto"), gt(chatAction.createdAt, new Date(maintenant.getTime() - JOUR))));
  const fin = new Date(maintenant.getTime() + (deja ? HEURE : 10 * MINUTE));
  await tx.update(chatAuthor).set({ mutedUntil: fin }).where(eq(chatAuthor.id, auteur.id));
  await journal(tx, maintenant, "mute_auto", null, auteur.id, { jusqua: fin.toISOString() });
  return fin;
}

async function envoyer(db: Db, envoi: Envoi): Promise<Issue> {
  const maintenant = envoi.maintenant ?? new Date();
  const pseudo = nettoyer(envoi.pseudo);
  const texte = nettoyer(envoi.texte);
  const refusPseudo = verifierFormePseudo(pseudo);
  if (refusPseudo) return { issue: "refuse", raison: refusPseudo, code: "pseudo" };
  const refusForme = verifierForme(texte);
  if (refusForme) return { issue: "refuse", raison: refusForme };
  // Un nouveau pseudo : la vérification anti-robots d'abord, hors de la transaction (un appel à Cloudflare).
  const connu = envoi.jeton ? await auteurDuJeton(db, envoi.jeton) : null;
  if (!connu && envoi.humain && !(await envoi.humain())) return { issue: "refuse", raison: "la vérification anti-robots n'a pas abouti, réessaie.", code: "humain" };

  return db.transaction(async (tx) => {
    const reglages = await lireReglages(tx);
    // 1-2. L'identité : le pseudo d'abord, nouveau ou changé.
    let auteur = envoi.jeton ? await auteurDuJeton(tx, envoi.jeton) : null;
    let jeton: string | undefined;
    if (!auteur) {
      if (envoi.ip && (await ipBannie(tx, envoi.ip, maintenant))) return { issue: "refuse", raison: "tu ne peux plus passer à l'antenne.", code: "coupe" };
      const cle = cleDePseudo(pseudo);
      const pris = await pseudoPris(tx, pseudo, cle, null, maintenant);
      if (pris) return { issue: "refuse", raison: pris, code: "pseudo" };
      jeton = randomBytes(32).toString("base64url");
      const [cree] = await tx.insert(chatAuthor).values({ tokenHash: empreinte(jeton), pseudo, pseudoKey: cle, color: envoi.couleur, lastSeenAt: maintenant }).returning();
      if (!cree) throw new Error("antenne : l'auteur n'a pas été créé.");
      auteur = cree;
    } else {
      if (auteur.bannedAt) return { issue: "refuse", raison: "tu ne peux plus passer à l'antenne.", code: "coupe" };
      if (auteur.mutedUntil && auteur.mutedUntil > maintenant)
        return { issue: "refuse", raison: `ton antenne est coupée jusqu'à ${aParis(auteur.mutedUntil)}.`, code: "coupe" };
      if (auteur.pseudo !== pseudo || auteur.color !== envoi.couleur) {
        const renomme = await renommer(tx, auteur, pseudo, envoi.couleur, maintenant);
        if (typeof renomme === "string") return { issue: "refuse", raison: renomme, code: "pseudo" };
        auteur = renomme;
      }
    }
    const refus = (raison: string): Issue => ({ issue: "refuse", raison, ...(jeton ? { jeton } : {}) });

    // 3. L'état : l'antenne ouverte, le mode lent.
    if (!reglages.open) return refus("l'antenne est fermée.");
    const recents = await tx
      .select({ body: chatMessage.body, createdAt: chatMessage.createdAt })
      .from(chatMessage)
      .where(and(eq(chatMessage.authorId, auteur.id), gt(chatMessage.createdAt, new Date(maintenant.getTime() - 2 * MINUTE))))
      .orderBy(desc(chatMessage.createdAt))
      .limit(10);
    const dernier = recents[0]?.createdAt.getTime() ?? 0;
    if (reglages.slowSeconds && maintenant.getTime() - dernier < reglages.slowSeconds * SECONDE)
      return refus(`mode lent : réessaie dans ${Math.ceil((dernier + reglages.slowSeconds * SECONDE - maintenant.getTime()) / SECONDE)} s.`);

    // 4. Le débit : par personne, puis par adresse IP, tous pseudos confondus.
    const trenteSecondes = recents.filter((m) => maintenant.getTime() - m.createdAt.getTime() < 30 * SECONDE);
    if (trenteSecondes.length >= 5)
      return refus(`doucement : réessaie dans ${Math.ceil((trenteSecondes.at(-1)!.createdAt.getTime() + 30 * SECONDE - maintenant.getTime()) / SECONDE)} s.`);
    if (envoi.ip) {
      const [ligne] = lignes<{ n: number }>(
        await tx.execute(sql`select count(*)::int as n from private.chat_trace where ip = ${envoi.ip}::inet
          and created_at > ${new Date(maintenant.getTime() - MINUTE).toISOString()}::timestamptz`),
      );
      if ((ligne?.n ?? 0) >= 20) return refus("doucement : réessaie dans une minute.");
    }

    // 5. La forme (vérifiée plus haut), et les doublons.
    if (recents.slice(0, 3).some((m) => essentiel(m.body) === essentiel(texte))) return refus("message déjà envoyé.");

    // 6-9. Les liens, les coordonnées, la liste de mots, le mode prudent.
    const termes = await tx.select({ term: chatTerm.term, action: chatTerm.action, anywhere: chatTerm.anywhere }).from(chatTerm);
    const liste = appliquerListe(texte, termes);
    let statut: "visible" | "held" | "refused" = "visible";
    let raison: string | null = null;
    let categorie: string | null = null;
    const refusLiens = verifierLiens(texte, reglages.links);
    if (refusLiens) [statut, raison, categorie] = ["refused", refusLiens, "liens"];
    else if (aDesCoordonnees(texte)) [statut, raison, categorie] = ["refused", "pas de coordonnées à l'antenne.", "coordonnees"];
    else if (liste.action === "refuse") [statut, raison, categorie] = ["refused", "propos interdits.", "propos"];
    else if (liste.action === "hold") [statut, raison, categorie] = ["held", "en attente de la régie.", "propos"];
    else if (reglages.careful) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(chatMessage)
        .where(and(eq(chatMessage.authorId, auteur.id), eq(chatMessage.status, "visible")));
      if (n < 2) [statut, raison, categorie] = ["held", "nouveau pseudo : la régie lit ses premiers messages.", "prudent"];
    }

    const corps = liste.action === "mask" ? liste.texte : texte;
    const [message] = await tx
      .insert(chatMessage)
      .values({
        authorId: auteur.id,
        pseudo: auteur.pseudo,
        color: auteur.color,
        body: corps,
        status: statut,
        onAirAt: new Date(maintenant.getTime() + (statut === "visible" ? reglages.delaySeconds * SECONDE : 0)),
        reason: raison,
        createdAt: maintenant,
      })
      .returning(colonnesPubliques);
    if (!message) throw new Error("antenne : le message n'a pas été écrit.");
    await tx.execute(sql`insert into private.chat_trace (message_id, author_id, ip, created_at)
      values (${message.id}, ${auteur.id}, ${envoi.ip}::inet, ${maintenant.toISOString()}::timestamptz)`);
    await tx.update(chatAuthor).set({ lastSeenAt: maintenant }).where(eq(chatAuthor.id, auteur.id));
    if (statut !== "visible") await journal(tx, maintenant, statut === "held" ? "hold" : "refuse", message.id, auteur.id, { raison, categorie });
    else if (liste.action === "mask") await journal(tx, maintenant, "mask", message.id, auteur.id);

    if (statut === "refused") {
      const fin = categorie && GRAVES.includes(categorie) ? await sanctionner(tx, auteur, maintenant) : null;
      return refus(fin ? `${raison} Ton antenne est coupée jusqu'à ${aParis(fin)}.` : raison!);
    }
    return { issue: statut === "held" ? "attente" : "antenne", message: messagePublic(message), ...(jeton ? { jeton } : {}) };
  });
}

/** Un auditeur signale un message : au seuil de la régie, il est brouillé en attendant qu'elle le voie. */
async function signaler(db: Db, { jeton, messageId, motif, maintenant = new Date() }: { jeton: string | null; messageId: string; motif: string; maintenant?: Date }) {
  return db.transaction(async (tx): Promise<{ ok: true } | { ok: false; raison: string }> => {
    const auteur = jeton ? await auteurDuJeton(tx, jeton) : null;
    if (!auteur) return { ok: false, raison: "passe d'abord un message à l'antenne : il faut un pseudo pour signaler." };
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(chatReport)
      .where(and(eq(chatReport.reporterId, auteur.id), gt(chatReport.createdAt, new Date(maintenant.getTime() - HEURE))));
    if (n >= 10) return { ok: false, raison: "dix signalements par heure au plus." };
    const [message] = await tx.select({ id: chatMessage.id, status: chatMessage.status }).from(chatMessage).where(eq(chatMessage.id, messageId)).limit(1);
    if (!message) return { ok: false, raison: "ce message n'est plus à l'antenne." };
    await tx
      .insert(chatReport)
      .values({ messageId, reporterId: auteur.id, reason: motif.slice(0, 60) || "autre", createdAt: maintenant })
      .onConflictDoNothing();
    const reglages = await lireReglages(tx);
    const [{ total } = { total: 0 }] = await tx
      .select({ total: countDistinct(chatReport.reporterId) })
      .from(chatReport)
      .where(and(eq(chatReport.messageId, messageId), isNull(chatReport.handledAt)));
    if (message.status === "visible" && total >= reglages.reportThreshold) {
      await tx
        .update(chatMessage)
        .set({ status: "removed", decidedBy: "reports", reason: "brouillé après des signalements.", removedAt: maintenant })
        .where(eq(chatMessage.id, messageId));
      await tx.insert(chatAction).values({ actor: "reports", action: "remove", messageId, authorId: null, details: { signalements: total } });
    }
    return { ok: true };
  });
}

async function moi(db: Db, jeton: string | null, maintenant = new Date()): Promise<Moi | null> {
  const auteur = jeton ? await auteurDuJeton(db, jeton) : null;
  if (!auteur) return null;
  const messages = await db
    .select({ id: chatMessage.id, status: chatMessage.status, reason: chatMessage.reason })
    .from(chatMessage)
    .where(and(eq(chatMessage.authorId, auteur.id), gt(chatMessage.createdAt, new Date(maintenant.getTime() - HEURE))))
    .orderBy(desc(chatMessage.createdAt))
    .limit(20);
  const STATUTS = { visible: "antenne", held: "attente", refused: "refuse", removed: "brouille" } as const;
  return {
    pseudo: auteur.pseudo,
    couleur: auteur.color,
    exclusion: auteur.mutedUntil && auteur.mutedUntil > maintenant ? auteur.mutedUntil.toISOString() : null,
    banni: auteur.bannedAt !== null,
    messages: messages.map((m) => ({ id: m.id, statut: STATUTS[m.status], raison: m.reason })),
  };
}

export function createAntenne(db: Db) {
  return {
    /** L'état de l'antenne : ouverte, mode lent, différé, messages au bandeau, liens. */
    etat: async (): Promise<EtatAntenne> => etatDe(await lireReglages(db)),
    /** Les derniers messages passés à l'antenne depuis le dernier vidage, du plus ancien au plus récent. */
    historique: async ({ maintenant = new Date(), limite = 50 }: { maintenant?: Date; limite?: number } = {}): Promise<MessageAntenne[]> => {
      const reglages = await lireReglages(db);
      const lus = await db
        .select(colonnesPubliques)
        .from(chatMessage)
        .where(and(eq(chatMessage.status, "visible"), lte(chatMessage.onAirAt, maintenant), reglages.clearedAt ? gt(chatMessage.createdAt, reglages.clearedAt) : undefined))
        .orderBy(desc(chatMessage.onAirAt))
        .limit(Math.min(Math.max(limite, 1), 100));
      return lus.reverse().map(messagePublic);
    },
    /** Envoyer : le pseudo (un changement de pseudo ou de couleur passe avec le message), puis le message ; la modération décide. */
    envoyer: (envoi: Envoi) => envoyer(db, envoi),
    signaler: (signalement: { jeton: string | null; messageId: string; motif: string; maintenant?: Date }) => signaler(db, signalement),
    moi: (jeton: string | null, maintenant?: Date) => moi(db, jeton, maintenant),
  };
}

export type Antenne = ReturnType<typeof createAntenne>;
