/**
 * Les candidatures dans l'admin (cms/README.md, 9.17) : la liste, une candidature, et ce que l'équipe en fait. Tout
 * passe sous le rôle de la personne connectée : les règles de 0020_candidatures_acces.sql décident. Un oui crée la fiche
 * d'invité, en brouillon (son nom, son Instagram, son activité), ou reprend la fiche qui porte déjà ce nom, puis son
 * lien d'envoi ; l'écran prépare le message à lui envoyer. Un refus garde la candidature six mois, le temps de la
 * reprendre si l'équipe change d'avis, puis la tâche de nuit l'efface.
 */
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { MOIS_GARDES, type Reglages } from "../candidatures/index.ts";
import { TYPES_CANDIDATURE } from "../candidatures/regles.ts";
import { escapeLike } from "../read/search.ts";
import { application, applicationSettings, applicationStatus, applicationTag, artist, facet, member, showType, tag, tagGroup, type ApplicationStatus, type ContentStatus, type ShowType } from "../schema.ts";
import { slugify } from "../slug.ts";
import { saveArtist } from "./artists.ts";
import type { NotSaved } from "./common.ts";
import { renewUploadLink, uploadLinkOf } from "./envois.ts";
import { isUuid } from "./input.ts";

/** L'activité d'un invité, d'après le type de sa candidature : les étiquettes du filtre Activité des artistes. */
const ACTIVITE: Record<ShowType, string> = { dj_set: "dj", podcast: "podcast", playlist: "playlist" };

export type AdminApplicationFilters = {
  /** « todo » (à écouter et mises de côté, par défaut), un statut, ou « all ». */
  status?: string;
  type?: string;
  /** « 1 » : les émissions déjà enregistrées. */
  ready?: string;
  /** « 1 » : celles qui attendent leur réponse depuis plus que le délai annoncé. */
  late?: string;
  q?: string;
};

export type AdminApplicationRow = {
  id: string;
  name: string;
  type: ShowType;
  ready: boolean;
  regular: boolean | null;
  city: string | null;
  instagram: string | null;
  email: string | null;
  status: ApplicationStatus;
  createdAt: Date;
  answeredAt: Date | null;
  /** Sans réponse depuis plus que le délai annoncé. */
  late: boolean;
};

export type AdminApplication = AdminApplicationRow & {
  pitch: string;
  listenUrl: string | null;
  note: string | null;
  styles: { slug: string; name: string }[];
  /** La fiche née du oui, son statut et son lien d'envoi. */
  artist: { id: string; name: string; status: ContentStatus; token: string | null } | null;
  /** Qui a répondu. */
  answeredBy: string | null;
  /** Une fiche qui porte déjà ce nom : le oui la reprendra plutôt que d'en créer une seconde. */
  sameName: { id: string; name: string } | null;
  /** Le jour où un refus sera effacé. */
  erasedAt: Date | null;
};

export type ApplicationCounts = { new: number; shortlisted: number; late: number; ready: number };

/** Une candidature attend sa réponse depuis plus que le délai annoncé. */
const enRetard = (now: Date, replyDays: number) =>
  sql<boolean>`(${application.status} in ('new', 'shortlisted') and ${application.createdAt} < ${new Date(now.getTime() - replyDays * 86_400_000).toISOString()}::timestamptz)`;

async function replyDaysOf(tx: Tx): Promise<number> {
  const [row] = await tx.select({ replyDays: applicationSettings.replyDays }).from(applicationSettings).limit(1);
  return row?.replyDays ?? 21;
}

/** Les candidatures, les plus récentes d'abord, et le compte de chaque statut (pour les pastilles de la liste). */
export async function listApplications(
  tx: Tx,
  filters: AdminApplicationFilters = {},
  now = new Date(),
): Promise<{ rows: AdminApplicationRow[]; total: number; counts: Record<ApplicationStatus, number> }> {
  const replyDays = await replyDaysOf(tx);
  const where: (SQL | undefined)[] = [];
  const status = filters.status ?? "todo";
  if (status === "todo") where.push(inArray(application.status, ["new", "shortlisted"]));
  else if ((applicationStatus.enumValues as readonly string[]).includes(status)) where.push(eq(application.status, status as ApplicationStatus));
  if (filters.type && (showType.enumValues as readonly string[]).includes(filters.type)) where.push(eq(application.type, filters.type as ShowType));
  if (filters.ready === "1") where.push(eq(application.ready, true));
  if (filters.late === "1") where.push(enRetard(now, replyDays));
  const q = filters.q?.trim();
  if (q) {
    const motif = `%${escapeLike(q)}%`;
    where.push(or(ilike(application.name, motif), ilike(application.instagram, motif), ilike(application.email, motif), ilike(application.city, motif)));
  }
  const rows = await tx
    .select({
      id: application.id,
      name: application.name,
      type: application.type,
      ready: application.ready,
      regular: application.regular,
      city: application.city,
      instagram: application.instagram,
      email: application.email,
      status: application.status,
      createdAt: application.createdAt,
      answeredAt: application.answeredAt,
      late: enRetard(now, replyDays),
    })
    .from(application)
    .where(and(...where))
    .orderBy(desc(application.createdAt));
  const parStatut = await tx.select({ status: application.status, n: count() }).from(application).groupBy(application.status);
  const counts = Object.fromEntries(applicationStatus.enumValues.map((one) => [one, 0])) as Record<ApplicationStatus, number>;
  for (const { status: one, n } of parStatut) counts[one] = n;
  return { rows, total: rows.length, counts };
}

/** Une candidature, avec ses styles, la fiche née de son oui et son lien d'envoi ; null si elle n'existe pas (ou plus). */
export async function getApplication(tx: Tx, id: string, now = new Date()): Promise<AdminApplication | null> {
  if (!isUuid(id)) return null;
  const replyDays = await replyDaysOf(tx);
  const [row] = await tx
    .select({
      id: application.id,
      name: application.name,
      type: application.type,
      ready: application.ready,
      regular: application.regular,
      city: application.city,
      instagram: application.instagram,
      email: application.email,
      status: application.status,
      createdAt: application.createdAt,
      answeredAt: application.answeredAt,
      late: enRetard(now, replyDays),
      pitch: application.pitch,
      listenUrl: application.listenUrl,
      note: application.note,
      artistId: application.artistId,
      answeredBy: member.name,
    })
    .from(application)
    .leftJoin(member, eq(member.userId, application.answeredBy))
    .where(eq(application.id, id))
    .limit(1);
  if (!row) return null;
  const styles = await tx
    .select({ slug: tag.slug, name: tag.name })
    .from(applicationTag)
    .innerJoin(tag, eq(tag.id, applicationTag.tagId))
    .where(eq(applicationTag.applicationId, id))
    .orderBy(asc(tag.name));
  let fiche: AdminApplication["artist"] = null;
  if (row.artistId) {
    const [linked] = await tx.select({ id: artist.id, name: artist.name, status: artist.status }).from(artist).where(eq(artist.id, row.artistId)).limit(1);
    if (linked) fiche = { ...linked, token: (await uploadLinkOf(tx, linked.id))?.token ?? null };
  }
  const sameName = fiche ? null : await artistNamed(tx, row.name);
  const { artistId: _artistId, ...rest } = row;
  const erasedAt = row.status === "declined" && row.answeredAt ? new Date(new Date(row.answeredAt).setUTCMonth(row.answeredAt.getUTCMonth() + MOIS_GARDES)) : null;
  return { ...rest, styles, artist: fiche, sameName, erasedAt };
}

/** La fiche qui porte déjà ce nom (sans tenir compte des majuscules), s'il y en a une. */
async function artistNamed(tx: Tx, name: string): Promise<{ id: string; name: string } | null> {
  const [found] = await tx
    .select({ id: artist.id, name: artist.name })
    .from(artist)
    .where(sql`lower(${artist.name}) = lower(${name})`)
    .orderBy(asc(artist.createdAt))
    .limit(1);
  return found ?? null;
}

/** La note de l'équipe. */
export async function noteApplication(tx: Tx, id: string, note: string): Promise<{ ok: true } | NotSaved> {
  if (!isUuid(id)) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  const texte = note.trim().slice(0, 4000);
  const done = await tx.update(application).set({ note: texte || null }).where(eq(application.id, id)).returning({ id: application.id });
  return done.length ? { ok: true } : { ok: false, errors: { form: "Cette candidature n'existe plus." } };
}

/**
 * Remet une candidature à écouter, ou la met de côté. Un refus peut être repris tant qu'il n'est pas effacé ; un oui,
 * non : sa fiche et son lien existent déjà.
 */
export async function moveApplication(tx: Tx, id: string, to: "new" | "shortlisted"): Promise<{ ok: true } | NotSaved> {
  if (!isUuid(id)) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  const [current] = await tx.select({ status: application.status }).from(application).where(eq(application.id, id)).for("update");
  if (!current) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  if (current.status === "accepted") return { ok: false, errors: { form: "Cette candidature est déjà acceptée : sa fiche et son lien d'envoi existent." } };
  await tx.update(application).set({ status: to, answeredAt: null, answeredBy: null }).where(eq(application.id, id));
  return { ok: true };
}

export type Accepted = { ok: true; artistId: string; artistName: string; token: string; reused: boolean };

/**
 * Le oui : la fiche d'invité, en brouillon, avec son nom, son Instagram et son activité (ou la fiche qui porte déjà ce
 * nom), puis son lien d'envoi (celui qu'elle a déjà, sinon un nouveau). Tout ou rien, dans la transaction de l'écran.
 */
export async function acceptApplication(tx: Tx, id: string, userId: string): Promise<Accepted | NotSaved> {
  if (!isUuid(id)) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  const [current] = await tx
    .select({ status: application.status, name: application.name, type: application.type, instagram: application.instagram, artistId: application.artistId })
    .from(application)
    .where(eq(application.id, id))
    .for("update");
  if (!current) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  if (current.status === "accepted" && current.artistId) {
    const [linked] = await tx.select({ name: artist.name }).from(artist).where(eq(artist.id, current.artistId)).limit(1);
    const link = (await uploadLinkOf(tx, current.artistId)) ?? (await renewUploadLink(tx, current.artistId, userId));
    if (linked && link) return { ok: true, artistId: current.artistId, artistName: linked.name, token: link.token, reused: true };
  }

  let fiche = await artistNamed(tx, current.name);
  const reused = Boolean(fiche);
  if (!fiche) {
    const [activite] = await tx
      .select({ id: tag.id })
      .from(tag)
      .innerJoin(tagGroup, eq(tagGroup.tagId, tag.id))
      .innerJoin(facet, eq(facet.id, tagGroup.facetId))
      .where(and(eq(facet.scope, "artist"), eq(tag.slug, ACTIVITE[current.type])))
      .limit(1);
    const saved = await saveArtist(tx, {
      values: {
        name: current.name,
        slug: slugify(current.name) || "invite",
        slugFromTitle: true,
        role: "guest",
        bio: null,
        links: current.instagram ? [{ label: "Instagram", url: `https://www.instagram.com/${current.instagram}/` }] : [],
        tags: activite ? [activite.id] : [],
      },
    });
    if (!saved.ok) return saved;
    fiche = { id: saved.id, name: current.name };
  }
  const link = (await uploadLinkOf(tx, fiche.id)) ?? (await renewUploadLink(tx, fiche.id, userId));
  if (!link) return { ok: false, errors: { form: "La fiche de l'invité n'a pas pu recevoir son lien d'envoi." } };
  await tx.update(application).set({ status: "accepted", artistId: fiche.id, answeredAt: sql`now()`, answeredBy: userId }).where(eq(application.id, id));
  return { ok: true, artistId: fiche.id, artistName: fiche.name, token: link.token, reused };
}

/** « Pas cette fois » : la réponse est notée ; la candidature sera effacée six mois après. */
export async function declineApplication(tx: Tx, id: string, userId: string): Promise<{ ok: true } | NotSaved> {
  if (!isUuid(id)) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  const [current] = await tx.select({ status: application.status }).from(application).where(eq(application.id, id)).for("update");
  if (!current) return { ok: false, errors: { form: "Cette candidature n'existe plus." } };
  if (current.status === "accepted") return { ok: false, errors: { form: "Cette candidature est déjà acceptée : sa fiche et son lien d'envoi existent." } };
  if (current.status !== "declined") await tx.update(application).set({ status: "declined", answeredAt: sql`now()`, answeredBy: userId }).where(eq(application.id, id));
  return { ok: true };
}

/** Efface une candidature tout de suite (indésirable, ou demandé par la personne). Rend son nom, ou null. */
export async function deleteApplication(tx: Tx, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(application).where(eq(application.id, id)).returning({ name: application.name });
  return removed?.name ?? null;
}

/** Les réglages : les types ouverts, le délai de réponse annoncé. */
export async function getApplicationSettings(tx: Tx): Promise<Reglages> {
  const [row] = await tx.select({ openTypes: applicationSettings.openTypes, replyDays: applicationSettings.replyDays }).from(applicationSettings).limit(1);
  return row ?? { openTypes: [...TYPES_CANDIDATURE], replyDays: 21 };
}

/** Enregistre les réglages (un admin seulement : la base refuse les autres, sans erreur, d'où la vérification du retour). */
export async function saveApplicationSettings(tx: Tx, { openTypes, replyDays }: { openTypes: string[]; replyDays: number }): Promise<{ ok: true } | NotSaved> {
  const types = TYPES_CANDIDATURE.filter((type) => openTypes.includes(type));
  if (!Number.isInteger(replyDays) || replyDays < 1 || replyDays > 90) return { ok: false, errors: { replyDays: "Un délai entre 1 et 90 jours." } };
  const done = await tx.update(applicationSettings).set({ openTypes: types, replyDays }).where(eq(applicationSettings.id, true)).returning({ id: applicationSettings.id });
  return done.length ? { ok: true } : { ok: false, errors: { form: "Seul un admin règle les candidatures." } };
}

/** Pour l'accueil : à écouter, mises de côté, sans réponse au-delà du délai, et les émissions déjà prêtes qui attendent. */
export async function applicationCounts(tx: Tx, now = new Date()): Promise<ApplicationCounts> {
  const replyDays = await replyDaysOf(tx);
  const [row] = await tx
    .select({
      new: sql<number>`count(*) filter (where ${application.status} = 'new')`.mapWith(Number),
      shortlisted: sql<number>`count(*) filter (where ${application.status} = 'shortlisted')`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${enRetard(now, replyDays)})`.mapWith(Number),
      ready: sql<number>`count(*) filter (where ${application.ready} and ${application.status} in ('new', 'shortlisted'))`.mapWith(Number),
    })
    .from(application);
  return row ?? { new: 0, shortlisted: 0, late: 0, ready: 0 };
}
