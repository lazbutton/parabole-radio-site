/**
 * L'antenne libre dans l'admin, l'écran de la régie (/admin/antenne) : les réglages, les messages, ce qui attend la régie
 * (les messages en attente, les signalés), les exclusions et les bannissements, la liste de mots. Tout se lit et s'écrit
 * sous le rôle de la personne connectée : 0010_antenne_acces.sql réserve ces tables à l'équipe. Chaque décision va au
 * journal, au nom du membre ; la base diffuse elle-même ce qui change à l'antenne (un retrait, un message publié,
 * l'état, le vidage).
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { LONGUEUR_MAX, nettoyer } from "../chat/forme.ts";
import { chatAction, chatAuthor, chatLinks, chatMessage, chatReport, chatSettings, chatTerm, chatTermAction, type ChatColor, type ChatDecider, type ChatLinks, type ChatStatus, type ChatTermAction } from "../schema.ts";
import type { NotSaved } from "./common.ts";
import { isUuid } from "./input.ts";

export type AdminChatMessage = {
  id: string;
  pseudo: string;
  color: ChatColor;
  body: string;
  status: ChatStatus;
  reason: string | null;
  decidedBy: ChatDecider;
  /** Un message de la régie (Écrire en tant que Parabole). */
  team: boolean;
  authorId: string | null;
  onAirAt: Date;
  createdAt: Date;
  /** Les signalements pas encore vus par la régie. */
  reports: number;
  /** Le premier message de ce pseudo. */
  first: boolean;
};
export type AdminChatAuthor = { id: string; pseudo: string; color: ChatColor; mutedUntil: Date | null; bannedAt: Date | null; bannedReason: string | null; lastSeenAt: Date };
export type AdminChatTerm = { id: string; term: string; action: ChatTermAction; anywhere: boolean; note: string };
export type AdminChatSettings = {
  open: boolean;
  slowSeconds: number;
  delaySeconds: number;
  careful: boolean;
  ticker: boolean;
  links: ChatLinks;
  reportThreshold: number;
  clearedAt: Date | null;
};
export type AdminAntenne = {
  settings: AdminChatSettings;
  /** Les derniers messages, toutes issues confondues, du plus récent au plus ancien. */
  messages: AdminChatMessage[];
  /** Ce qui attend la régie, du plus ancien au plus récent : les messages en attente, puis les signalés. */
  held: AdminChatMessage[];
  reported: AdminChatMessage[];
  /** Les exclusions en cours et les bannissements. */
  people: AdminChatAuthor[];
  terms: AdminChatTerm[];
};
/** Les réglages qu'on change à l'écran. */
export type ChatSettingsChange = Partial<Omit<AdminChatSettings, "clearedAt">>;

export const SLOW_CHOICES = [0, 3, 5, 10, 30, 60] as const;
export const DELAY_CHOICES = [0, 5, 10, 30] as const;
export const MUTE_CHOICES = [1, 10, 60, 1440] as const;

// Les sous-requêtes nomment la table du message en entier : dans une requête sur une seule table, Drizzle écrit les
// colonnes sans leur table, et « id » y désignerait celle de la sous-requête.
const reports = sql<number>`(select count(*) from chat_report r where r.message_id = chat_message.id and r.handled_at is null)`.mapWith(Number);
const first = sql<boolean>`(chat_message.author_id is not null and not exists (select 1 from chat_message earlier
  where earlier.author_id = chat_message.author_id and earlier.created_at < chat_message.created_at))`;
const hasOpenReports = sql`exists (select 1 from chat_report r where r.message_id = chat_message.id and r.handled_at is null)`;
const messageColumns = {
  id: chatMessage.id,
  pseudo: chatMessage.pseudo,
  color: chatMessage.color,
  body: chatMessage.body,
  status: chatMessage.status,
  reason: chatMessage.reason,
  decidedBy: chatMessage.decidedBy,
  team: sql<boolean>`${chatMessage.memberId} is not null`,
  authorId: chatMessage.authorId,
  onAirAt: chatMessage.onAirAt,
  createdAt: chatMessage.createdAt,
  reports,
  first,
};

/** L'écran de la régie : tout ce qu'elle voit d'un coup. */
export async function antenneOverview(tx: Tx, { now = new Date(), limit = 150 }: { now?: Date; limit?: number } = {}): Promise<AdminAntenne> {
  const [settings] = await tx
    .select({
      open: chatSettings.open,
      slowSeconds: chatSettings.slowSeconds,
      delaySeconds: chatSettings.delaySeconds,
      careful: chatSettings.careful,
      ticker: chatSettings.ticker,
      links: chatSettings.links,
      reportThreshold: chatSettings.reportThreshold,
      clearedAt: chatSettings.clearedAt,
    })
    .from(chatSettings)
    .limit(1);
  const messages = await tx.select(messageColumns).from(chatMessage).orderBy(desc(chatMessage.createdAt)).limit(limit);
  const held = await tx.select(messageColumns).from(chatMessage).where(eq(chatMessage.status, "held")).orderBy(asc(chatMessage.createdAt));
  const reported = await tx.select(messageColumns).from(chatMessage).where(hasOpenReports).orderBy(asc(chatMessage.createdAt));
  const people = await tx
    .select({
      id: chatAuthor.id,
      pseudo: chatAuthor.pseudo,
      color: chatAuthor.color,
      mutedUntil: chatAuthor.mutedUntil,
      bannedAt: chatAuthor.bannedAt,
      bannedReason: chatAuthor.bannedReason,
      lastSeenAt: chatAuthor.lastSeenAt,
    })
    .from(chatAuthor)
    .where(or(gt(chatAuthor.mutedUntil, now), isNotNull(chatAuthor.bannedAt)))
    .orderBy(desc(chatAuthor.updatedAt));
  const terms = await tx
    .select({ id: chatTerm.id, term: chatTerm.term, action: chatTerm.action, anywhere: chatTerm.anywhere, note: chatTerm.note })
    .from(chatTerm)
    .orderBy(asc(chatTerm.term));
  return {
    settings: settings ?? { open: true, slowSeconds: 0, delaySeconds: 0, careful: false, ticker: true, links: "music", reportThreshold: 3, clearedAt: null },
    messages,
    held,
    reported,
    people,
    terms,
  };
}

/** Une décision de la régie, au journal, au nom du membre. */
const log = (tx: Tx, userId: string, action: string, messageId: string | null, authorId: string | null, details: Record<string, unknown> = {}) =>
  tx.insert(chatAction).values({ actor: "team", memberId: userId, action, messageId, authorId, details });

/** Les signalements d'un message, vus par la régie. */
const handleReports = (tx: Tx, userId: string, messageId: string, now: Date) =>
  tx.update(chatReport).set({ handledAt: now, handledBy: userId }).where(and(eq(chatReport.messageId, messageId), isNull(chatReport.handledAt)));

/** Retirer un message : brouillé par la régie chez tout le monde, ou jamais passé s'il était encore en différé. */
export async function removeChatMessage(tx: Tx, userId: string, id: string, now = new Date()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [removed] = await tx
    .update(chatMessage)
    .set({ status: "removed", decidedBy: "team", reason: "brouillé par la régie.", removedAt: now, removedBy: userId })
    .where(and(eq(chatMessage.id, id), inArray(chatMessage.status, ["visible", "held"])))
    .returning({ id: chatMessage.id, authorId: chatMessage.authorId });
  if (!removed) return false;
  await handleReports(tx, userId, id, now);
  await log(tx, userId, "remove", id, removed.authorId);
  return true;
}

/** Publier un message en attente, ou rendre l'antenne à un message brouillé : il passe maintenant. */
export async function publishChatMessage(tx: Tx, userId: string, id: string, now = new Date()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [published] = await tx
    .update(chatMessage)
    .set({ status: "visible", decidedBy: "team", reason: null, onAirAt: now, removedAt: null, removedBy: null })
    .where(and(eq(chatMessage.id, id), inArray(chatMessage.status, ["held", "removed"])))
    .returning({ id: chatMessage.id, authorId: chatMessage.authorId });
  if (!published) return false;
  await handleReports(tx, userId, id, now);
  await log(tx, userId, "publish", id, published.authorId);
  return true;
}

/** Rejeter un message en attente : il ne passera pas ; son auteur le lit. */
export async function rejectChatMessage(tx: Tx, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [rejected] = await tx
    .update(chatMessage)
    .set({ status: "refused", decidedBy: "team", reason: "la régie ne l'a pas passé." })
    .where(and(eq(chatMessage.id, id), eq(chatMessage.status, "held")))
    .returning({ id: chatMessage.id, authorId: chatMessage.authorId });
  if (!rejected) return false;
  await log(tx, userId, "reject", id, rejected.authorId);
  return true;
}

/** Garder un message signalé : la régie l'a lu, il reste à l'antenne. */
export async function keepChatMessage(tx: Tx, userId: string, id: string, now = new Date()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const kept = await tx
    .update(chatReport)
    .set({ handledAt: now, handledBy: userId })
    .where(and(eq(chatReport.messageId, id), isNull(chatReport.handledAt)))
    .returning({ id: chatReport.id });
  if (!kept.length) return false;
  await log(tx, userId, "keep", id, null, { signalements: kept.length });
  return true;
}

/** Les messages d'un auteur encore à l'écran (la dernière demi-heure), brouillés avec sa sanction. */
async function removeRecent(tx: Tx, userId: string, authorId: string, now: Date) {
  await tx
    .update(chatMessage)
    .set({ status: "removed", decidedBy: "team", reason: "brouillé par la régie.", removedAt: now, removedBy: userId })
    .where(and(eq(chatMessage.authorId, authorId), eq(chatMessage.status, "visible"), gt(chatMessage.createdAt, new Date(now.getTime() - 30 * 60_000))));
}

/** Exclure un moment (1 min, 10 min, 1 h ou 24 h) : il ne peut plus écrire jusque-là. */
export async function muteChatAuthor(tx: Tx, userId: string, authorId: string, minutes: number, now = new Date()): Promise<boolean> {
  if (!isUuid(authorId) || !(MUTE_CHOICES as readonly number[]).includes(minutes)) return false;
  const until = new Date(now.getTime() + minutes * 60_000);
  const [muted] = await tx.update(chatAuthor).set({ mutedUntil: until }).where(eq(chatAuthor.id, authorId)).returning({ id: chatAuthor.id });
  if (!muted) return false;
  await removeRecent(tx, userId, authorId, now);
  await log(tx, userId, "mute", null, authorId, { minutes, jusqua: until.toISOString() });
  return true;
}

/** Bannir : il ne peut plus écrire, et un nouveau pseudo depuis la même adresse est refusé 24 heures. */
export async function banChatAuthor(tx: Tx, userId: string, authorId: string, reason: string, now = new Date()): Promise<boolean> {
  if (!isUuid(authorId)) return false;
  const [banned] = await tx
    .update(chatAuthor)
    .set({ bannedAt: now, bannedReason: nettoyer(reason).slice(0, 200) || null, bannedBy: userId })
    .where(eq(chatAuthor.id, authorId))
    .returning({ id: chatAuthor.id });
  if (!banned) return false;
  await removeRecent(tx, userId, authorId, now);
  await log(tx, userId, "ban", null, authorId, { raison: reason });
  return true;
}

/** Lever une exclusion ou un bannissement. */
export async function liftChatAuthor(tx: Tx, userId: string, authorId: string): Promise<boolean> {
  if (!isUuid(authorId)) return false;
  const [lifted] = await tx
    .update(chatAuthor)
    .set({ mutedUntil: null, bannedAt: null, bannedReason: null, bannedBy: null })
    .where(eq(chatAuthor.id, authorId))
    .returning({ id: chatAuthor.id });
  if (!lifted) return false;
  await log(tx, userId, "lift", null, authorId);
  return true;
}

/** Vider l'antenne : les messages partent dans la neige, les nouveaux venus ne voient que ce qui suit. */
export async function clearChat(tx: Tx, userId: string, now = new Date()): Promise<void> {
  await tx.update(chatSettings).set({ clearedAt: now, updatedBy: userId });
  await log(tx, userId, "clear", null, null);
}

/** Changer des réglages : seuls les choix de l'écran sont permis (la base les vérifie aussi). */
export async function saveChatSettings(tx: Tx, userId: string, change: ChatSettingsChange): Promise<{ ok: true } | NotSaved> {
  const values: ChatSettingsChange = {};
  if (change.open !== undefined) values.open = !!change.open;
  if (change.careful !== undefined) values.careful = !!change.careful;
  if (change.ticker !== undefined) values.ticker = !!change.ticker;
  if (change.slowSeconds !== undefined) {
    if (!(SLOW_CHOICES as readonly number[]).includes(change.slowSeconds)) return { ok: false, errors: { slowSeconds: "Choisis 0, 3, 5, 10, 30 ou 60 secondes." } };
    values.slowSeconds = change.slowSeconds;
  }
  if (change.delaySeconds !== undefined) {
    if (!(DELAY_CHOICES as readonly number[]).includes(change.delaySeconds)) return { ok: false, errors: { delaySeconds: "Choisis 0, 5, 10 ou 30 secondes." } };
    values.delaySeconds = change.delaySeconds;
  }
  if (change.links !== undefined) {
    if (!chatLinks.enumValues.includes(change.links)) return { ok: false, errors: { links: "Choisis aucun, plateformes de musique ou tous." } };
    values.links = change.links;
  }
  if (change.reportThreshold !== undefined) {
    if (!Number.isInteger(change.reportThreshold) || change.reportThreshold < 1 || change.reportThreshold > 20)
      return { ok: false, errors: { reportThreshold: "Entre 1 et 20 signalements." } };
    values.reportThreshold = change.reportThreshold;
  }
  if (!Object.keys(values).length) return { ok: true };
  await tx.update(chatSettings).set({ ...values, updatedBy: userId });
  await log(tx, userId, "settings", null, null, values);
  return { ok: true };
}

/** Ajouter un mot à la liste : ce qu'il fait d'un message, et s'il compte partout dans un mot. */
export async function addChatTerm(
  tx: Tx,
  userId: string,
  { term, action, anywhere = false, note = "" }: { term: string; action: string; anywhere?: boolean; note?: string },
): Promise<{ ok: true; id: string } | NotSaved> {
  const clean = nettoyer(term).toLowerCase();
  if (clean.length < 2 || clean.length > 60) return { ok: false, errors: { term: "Un mot ou une expression de 2 à 60 caractères." } };
  if (!chatTermAction.enumValues.includes(action as ChatTermAction)) return { ok: false, errors: { action: "Refuser, mettre en attente ou masquer." } };
  const [added] = await tx
    .insert(chatTerm)
    .values({ term: clean, action: action as ChatTermAction, anywhere: !!anywhere, note: nettoyer(note).slice(0, 200), createdBy: userId })
    .onConflictDoNothing()
    .returning({ id: chatTerm.id });
  if (!added) return { ok: false, errors: { term: "Ce mot est déjà dans la liste." } };
  await log(tx, userId, "term", null, null, { ajout: clean, action });
  return { ok: true, id: added.id };
}

/** Retirer un mot de la liste. Rend le mot, ou null s'il n'y était plus. */
export async function removeChatTerm(tx: Tx, userId: string, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(chatTerm).where(eq(chatTerm.id, id)).returning({ term: chatTerm.term });
  if (!removed) return null;
  await log(tx, userId, "term", null, null, { retrait: removed.term });
  return removed.term;
}

/** Écrire en tant que Parabole : la case PARABOLE à la place du pseudo, sans passer par la modération des auditeurs. */
export async function postAsTeam(tx: Tx, userId: string, text: string, now = new Date()): Promise<{ ok: true; id: string } | NotSaved> {
  const body = nettoyer(text);
  if (!body) return { ok: false, errors: { text: "Le message est vide." } };
  if ([...body].length > LONGUEUR_MAX) return { ok: false, errors: { text: `${LONGUEUR_MAX} caractères au plus.` } };
  const [posted] = await tx
    .insert(chatMessage)
    .values({ memberId: userId, pseudo: "Parabole", color: "yellow", body, status: "visible", onAirAt: now, decidedBy: "team", createdAt: now })
    .returning({ id: chatMessage.id });
  if (!posted) return { ok: false, errors: { form: "Le message n'est pas parti." } };
  await log(tx, userId, "post", posted.id, null);
  return { ok: true, id: posted.id };
}
