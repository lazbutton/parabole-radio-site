/**
 * Les candidatures dans l'admin (cms/README.md, 9.17) : la liste, une candidature, et ce que l'équipe en fait. Tout passe
 * sous le rôle de la personne connectée : les règles de 0020_candidatures_acces.sql décident. Seules les candidatures
 * envoyées comptent (un dossier en cours d'envoi n'existe pas encore pour l'équipe).
 *
 * Une candidature arrive avec son émission entière : l'écouter suffit. La valider crée la fiche d'invité, en brouillon
 * (son nom, sa bio, sa photo, son Instagram, son activité), ou reprend la fiche qui porte déjà ce nom, sans toucher à ce
 * qu'elle a déjà ; puis l'émission, en brouillon (titre, description, styles, tracklist), avec l'envoi et le son validé :
 * elle attend ensuite son créneau, comme l'envoi d'un résident (9.12). Un refus efface tout de suite le son et la photo,
 * et la candidature six mois après la réponse (la tâche de nuit).
 */
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { MOIS_GARDES, type Reglages } from "../candidatures/index.ts";
import { TYPES_CANDIDATURE } from "../candidatures/regles.ts";
import { outer } from "../read/common.ts";
import { escapeLike } from "../read/search.ts";
import {
  application,
  applicationSettings,
  applicationStatus,
  applicationTag,
  artist,
  artistTag,
  audioFile,
  facet,
  member,
  show,
  showArtist,
  showTag,
  showType,
  submission,
  tag,
  tagGroup,
  track,
  type ApplicationStatus,
  type ContentStatus,
  type ShowType,
} from "../schema.ts";
import { slugify } from "../slug.ts";
import { parseTimecode, parseTracklist } from "../tracklist.ts";
import { freeSlug, type NotSaved } from "./common.ts";
import { isUuid } from "./input.ts";
import { getMedia, releaseMedia, type AdminMedia } from "./media.ts";

/** L'activité d'un invité, d'après le type de sa candidature : les étiquettes du filtre Activité des artistes. */
const ACTIVITE: Record<ShowType, string> = { dj_set: "dj", podcast: "podcast", playlist: "playlist" };
const GONE: NotSaved = { ok: false, errors: { form: "Cette candidature n'existe plus : elle a peut-être été effacée." } };

export type AdminApplicationFilters = {
  /** « todo » (à écouter et mises de côté, par défaut), un statut, ou « all ». */
  status?: string;
  type?: string;
  /** « 1 » : celles qui attendent leur réponse depuis plus que le délai annoncé. */
  late?: string;
  q?: string;
};

export type AdminApplicationRow = {
  id: string;
  /** Le titre de l'émission (vide pour une candidature d'avant le son). */
  title: string | null;
  name: string;
  type: ShowType;
  regular: boolean | null;
  city: string | null;
  instagram: string | null;
  email: string | null;
  status: ApplicationStatus;
  /** Envoyée le… */
  createdAt: Date;
  answeredAt: Date | null;
  /** Un son est arrivé avec elle (sinon : le lien d'une playlist, ou une candidature d'avant le son). */
  hasSound: boolean;
  /** Sans réponse depuis plus que le délai annoncé. */
  late: boolean;
};

export type AdminApplication = AdminApplicationRow & {
  pitch: string;
  bio: string | null;
  photo: AdminMedia | null;
  listenUrl: string | null;
  tracklist: string | null;
  message: string | null;
  note: string | null;
  styles: { slug: string; name: string }[];
  /** Le son, à écouter et télécharger (/admin/api/son/<id>). */
  sound: { id: string; fileName: string; sizeBytes: number | null; status: string } | null;
  /** La fiche et l'émission nées de la validation. */
  artist: { id: string; name: string; status: ContentStatus } | null;
  show: { id: string; title: string; status: ContentStatus } | null;
  /** Qui a répondu. */
  answeredBy: string | null;
  /** Une fiche qui porte déjà ce nom : la validation la reprendra plutôt que d'en créer une seconde. */
  sameName: { id: string; name: string } | null;
  /** Le jour où un refus sera effacé. */
  erasedAt: Date | null;
};

export type ApplicationCounts = { new: number; shortlisted: number; late: number };

/** Une candidature envoyée attend sa réponse depuis plus que le délai annoncé. */
const enRetard = (now: Date, replyDays: number) =>
  sql<boolean>`(${application.status} in ('new', 'shortlisted') and ${application.submittedAt} < ${new Date(now.getTime() - replyDays * 86_400_000).toISOString()}::timestamptz)`;
const envoyee = isNotNull(application.submittedAt);
const aUnSon = sql<boolean>`exists (select 1 from ${audioFile} af where af.application_id = ${outer(application.id)} and af.status <> 'uploading')`;

async function replyDaysOf(tx: Tx): Promise<number> {
  const [row] = await tx.select({ replyDays: applicationSettings.replyDays }).from(applicationSettings).limit(1);
  return row?.replyDays ?? 21;
}

const rowColumns = (now: Date, replyDays: number) => ({
  id: application.id,
  title: application.title,
  name: application.name,
  type: application.type,
  regular: application.regular,
  city: application.city,
  instagram: application.instagram,
  email: application.email,
  status: application.status,
  createdAt: sql<Date>`coalesce(${application.submittedAt}, ${application.createdAt})`.mapWith((value) => new Date(value as string)),
  answeredAt: application.answeredAt,
  hasSound: aUnSon,
  late: enRetard(now, replyDays),
});

/** Les candidatures envoyées, les plus récentes d'abord, et le compte de chaque statut (pour les pastilles de la liste). */
export async function listApplications(
  tx: Tx,
  filters: AdminApplicationFilters = {},
  now = new Date(),
): Promise<{ rows: AdminApplicationRow[]; total: number; counts: Record<ApplicationStatus, number> }> {
  const replyDays = await replyDaysOf(tx);
  const where: (SQL | undefined)[] = [envoyee];
  const status = filters.status ?? "todo";
  if (status === "todo") where.push(inArray(application.status, ["new", "shortlisted"]));
  else if ((applicationStatus.enumValues as readonly string[]).includes(status)) where.push(eq(application.status, status as ApplicationStatus));
  if (filters.type && (showType.enumValues as readonly string[]).includes(filters.type)) where.push(eq(application.type, filters.type as ShowType));
  if (filters.late === "1") where.push(enRetard(now, replyDays));
  const q = filters.q?.trim();
  if (q) {
    const motif = `%${escapeLike(q)}%`;
    where.push(or(ilike(application.name, motif), ilike(application.title, motif), ilike(application.instagram, motif), ilike(application.email, motif), ilike(application.city, motif)));
  }
  const rows = await tx
    .select(rowColumns(now, replyDays))
    .from(application)
    .where(and(...where))
    .orderBy(desc(sql`coalesce(${application.submittedAt}, ${application.createdAt})`));
  const parStatut = await tx.select({ status: application.status, n: count() }).from(application).where(envoyee).groupBy(application.status);
  const counts = Object.fromEntries(applicationStatus.enumValues.map((one) => [one, 0])) as Record<ApplicationStatus, number>;
  for (const { status: one, n } of parStatut) counts[one] = n;
  return { rows, total: rows.length, counts };
}

/** Une candidature envoyée, avec son son, sa photo, ses styles, et ce que sa validation a créé ; null sinon. */
export async function getApplication(tx: Tx, id: string, now = new Date()): Promise<AdminApplication | null> {
  if (!isUuid(id)) return null;
  const replyDays = await replyDaysOf(tx);
  const [row] = await tx
    .select({
      ...rowColumns(now, replyDays),
      pitch: application.pitch,
      bio: application.bio,
      photoId: application.photoId,
      listenUrl: application.listenUrl,
      tracklist: application.tracklist,
      message: application.message,
      note: application.note,
      artistId: application.artistId,
      showId: application.showId,
      answeredBy: member.name,
    })
    .from(application)
    .leftJoin(member, eq(member.userId, application.answeredBy))
    .where(and(eq(application.id, id), envoyee))
    .limit(1);
  if (!row) return null;
  const styles = await tx
    .select({ slug: tag.slug, name: tag.name })
    .from(applicationTag)
    .innerJoin(tag, eq(tag.id, applicationTag.tagId))
    .where(eq(applicationTag.applicationId, id))
    .orderBy(asc(tag.name));
  // Le son : celui de la candidature, ou, une fois validée, celui de son émission.
  const [sound] = await tx
    .select({ id: audioFile.id, fileName: audioFile.fileName, sizeBytes: audioFile.sizeBytes, status: audioFile.status })
    .from(audioFile)
    .where(and(row.showId ? or(eq(audioFile.applicationId, id), and(eq(audioFile.showId, row.showId), eq(audioFile.role, "main"))) : eq(audioFile.applicationId, id), sql`${audioFile.status} <> 'uploading'`))
    .limit(1);
  const [fiche] = row.artistId ? await tx.select({ id: artist.id, name: artist.name, status: artist.status }).from(artist).where(eq(artist.id, row.artistId)).limit(1) : [];
  const [emission] = row.showId ? await tx.select({ id: show.id, title: show.title, status: show.status }).from(show).where(eq(show.id, row.showId)).limit(1) : [];
  const { artistId: _artistId, showId: _showId, photoId, ...rest } = row;
  const erasedAt = row.status === "declined" && row.answeredAt ? new Date(new Date(row.answeredAt).setUTCMonth(row.answeredAt.getUTCMonth() + MOIS_GARDES)) : null;
  return {
    ...rest,
    photo: await getMedia(tx, photoId),
    styles,
    sound: sound ?? null,
    artist: fiche ?? null,
    show: emission ?? null,
    sameName: fiche ? null : await artistNamed(tx, row.name),
    erasedAt,
  };
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

/** La candidature envoyée, verrouillée le temps de la réponse. */
async function locked(tx: Tx, id: string) {
  if (!isUuid(id)) return null;
  const [current] = await tx.select().from(application).where(and(eq(application.id, id), envoyee)).for("update");
  return current ?? null;
}

/** La note de l'équipe. */
export async function noteApplication(tx: Tx, id: string, note: string): Promise<{ ok: true } | NotSaved> {
  if (!isUuid(id)) return GONE;
  const texte = note.trim().slice(0, 4000);
  const done = await tx
    .update(application)
    .set({ note: texte || null })
    .where(and(eq(application.id, id), envoyee))
    .returning({ id: application.id });
  return done.length ? { ok: true } : GONE;
}

/**
 * Remet une candidature à écouter, ou la met de côté. Un refus peut être repris tant qu'il n'est pas effacé (son son et
 * sa photo, eux, sont déjà partis) ; une candidature validée, non : son émission existe.
 */
export async function moveApplication(tx: Tx, id: string, to: "new" | "shortlisted"): Promise<{ ok: true } | NotSaved> {
  const current = await locked(tx, id);
  if (!current) return GONE;
  if (current.status === "accepted") return { ok: false, errors: { form: "Cette candidature est déjà validée : son émission et sa fiche existent." } };
  await tx.update(application).set({ status: to, answeredAt: null, answeredBy: null }).where(eq(application.id, id));
  return { ok: true };
}

export type Accepted = { ok: true; artistId: string; artistName: string; showId: string; showTitle: string; reused: boolean };

/**
 * La validation : la fiche d'invité, en brouillon, avec son nom, sa bio, sa photo, son Instagram et son activité (ou la
 * fiche qui porte déjà ce nom, dont seuls la bio et la photo manquantes sont complétées) ; puis l'émission, en
 * brouillon, avec ses styles et sa tracklist, l'envoi (le lien d'une playlist, son mot pour l'équipe) et le son, validé.
 * Tout ou rien, dans la transaction de l'écran.
 */
export async function acceptApplication(tx: Tx, id: string, userId: string): Promise<Accepted | NotSaved> {
  const current = await locked(tx, id);
  if (!current) return GONE;
  if (current.status === "accepted" && current.artistId && current.showId) {
    const [linked] = await tx.select({ name: artist.name }).from(artist).where(eq(artist.id, current.artistId)).limit(1);
    const [emission] = await tx.select({ title: show.title }).from(show).where(eq(show.id, current.showId)).limit(1);
    if (linked && emission) return { ok: true, artistId: current.artistId, artistName: linked.name, showId: current.showId, showTitle: emission.title, reused: true };
  }
  const [son] = await tx.select({ id: audioFile.id }).from(audioFile).where(and(eq(audioFile.applicationId, id), eq(audioFile.status, "received"))).limit(1);
  if (!son && !current.listenUrl) return { ok: false, errors: { form: "Cette candidature n'a ni son ni lien de playlist : il n'y a rien à valider. Réponds-lui « Pas cette fois », ou demande-lui son émission." } };

  // La fiche : celle qui porte déjà ce nom (complétée seulement là où elle est vide), ou une nouvelle, d'invité.
  let fiche = await artistNamed(tx, current.name);
  const reused = Boolean(fiche);
  if (fiche) {
    await tx
      .update(artist)
      .set({ bio: sql`coalesce(${artist.bio}, ${current.bio})`, photoId: sql`coalesce(${artist.photoId}, ${current.photoId}::uuid)` })
      .where(eq(artist.id, fiche.id));
  } else {
    const slug = await freeSlug(tx, artist, slugify(current.name) || "invite");
    const [created] = await tx
      .insert(artist)
      .values({
        slug,
        name: current.name,
        role: "guest",
        bio: current.bio,
        photoId: current.photoId,
        links: current.instagram ? [{ label: "Instagram", url: `https://www.instagram.com/${current.instagram}/` }] : [],
      })
      .returning({ id: artist.id });
    fiche = { id: created!.id, name: current.name };
    const [activite] = await tx
      .select({ id: tag.id })
      .from(tag)
      .innerJoin(tagGroup, eq(tagGroup.tagId, tag.id))
      .innerJoin(facet, eq(facet.id, tagGroup.facetId))
      .where(and(eq(facet.scope, "artist"), eq(tag.slug, ACTIVITE[current.type])))
      .limit(1);
    if (activite) await tx.insert(artistTag).values({ artistId: fiche.id, tagId: activite.id });
  }

  // L'émission : en brouillon, sans date ; elle attend son créneau.
  const title = current.title ?? `${current.name} sur Parabole`;
  const [emission] = await tx
    .insert(show)
    .values({ slug: await freeSlug(tx, show, slugify(title) || "emission"), title, type: current.type, description: current.pitch })
    .returning({ id: show.id });
  const showId = emission!.id;
  await tx.insert(showArtist).values({ showId, artistId: fiche.id, position: 0 });
  const styles = await tx.select({ tagId: applicationTag.tagId }).from(applicationTag).where(eq(applicationTag.applicationId, id));
  if (styles.length) await tx.insert(showTag).values(styles.map(({ tagId }) => ({ showId, tagId })));
  const lignes = current.tracklist ? parseTracklist(current.tracklist).filter((line) => line.artist || line.title) : [];
  if (lignes.length)
    await tx.insert(track).values(
      lignes.map((line, index) => ({
        showId,
        position: index + 1,
        artist: (line.artist || "?").slice(0, 400),
        title: (line.title || "?").slice(0, 400),
        startSeconds: line.start ? parseTimecode(line.start) : null,
        hopperUrl: line.hopperUrl || null,
      })),
    );
  await tx.insert(submission).values({ showId, artistId: fiche.id, link: current.listenUrl, note: current.message });
  // Le son passe à l'émission, validé : il est prêt à charger dans Radio Cult, puis à partir sur SoundCloud.
  await tx.update(audioFile).set({ showId, applicationId: null, artistId: fiche.id, status: "approved" }).where(and(eq(audioFile.applicationId, id), eq(audioFile.status, "received")));
  await tx.update(application).set({ status: "accepted", artistId: fiche.id, showId, answeredAt: sql`now()`, answeredBy: userId }).where(eq(application.id, id));
  return { ok: true, artistId: fiche.id, artistName: fiche.name, showId, showTitle: title, reused };
}

/** Ce qu'un refus ou un effacement laisse à retirer : les clés du seau R2, et les images du Storage. */
export type Released = { keys: string[]; images: string[] };

/** Retire le son et la photo d'une candidature (pas ceux d'une candidature validée, qui servent à son émission). */
async function releaseFiles(tx: Tx, id: string, photoId: string | null): Promise<Released> {
  const sons = await tx.delete(audioFile).where(eq(audioFile.applicationId, id)).returning({ key: audioFile.key });
  await tx.update(application).set({ photoId: null }).where(eq(application.id, id));
  return { keys: sons.map((one) => one.key), images: await releaseMedia(tx, [photoId]) };
}

/** « Pas cette fois » : la réponse est notée, le son et la photo sont retirés ; la candidature est effacée six mois après. */
export async function declineApplication(tx: Tx, id: string, userId: string): Promise<({ ok: true } & Released) | NotSaved> {
  const current = await locked(tx, id);
  if (!current) return GONE;
  if (current.status === "accepted") return { ok: false, errors: { form: "Cette candidature est déjà validée : son émission et sa fiche existent." } };
  if (current.status !== "declined") await tx.update(application).set({ status: "declined", answeredAt: sql`now()`, answeredBy: userId }).where(eq(application.id, id));
  return { ok: true, ...(await releaseFiles(tx, id, current.photoId)) };
}

/** Efface une candidature tout de suite (indésirable, ou demandé par la personne). Rend son nom et ce qu'il reste à retirer, ou null. */
export async function deleteApplication(tx: Tx, id: string): Promise<({ name: string } & Released) | null> {
  const current = await locked(tx, id);
  if (!current) return null;
  const released = current.status === "accepted" ? { keys: [], images: [] } : await releaseFiles(tx, id, current.photoId);
  await tx.delete(application).where(eq(application.id, id));
  return { name: current.name, ...released };
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

/** Pour l'accueil : à écouter, mises de côté, et sans réponse au-delà du délai. */
export async function applicationCounts(tx: Tx, now = new Date()): Promise<ApplicationCounts> {
  const replyDays = await replyDaysOf(tx);
  const [row] = await tx
    .select({
      new: sql<number>`count(*) filter (where ${application.status} = 'new')`.mapWith(Number),
      shortlisted: sql<number>`count(*) filter (where ${application.status} = 'shortlisted')`.mapWith(Number),
      late: sql<number>`count(*) filter (where ${enRetard(now, replyDays)})`.mapWith(Number),
    })
    .from(application)
    .where(envoyee);
  return row ?? { new: 0, shortlisted: 0, late: 0 };
}
