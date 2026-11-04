/**
 * Les envois des résidents dans l'admin (cms/README.md, 9.12) : les liens d'envoi des artistes, ce qu'un show a reçu
 * (l'envoi, son son, ses morceaux), valider ou effacer un fichier, rattacher un envoi à son créneau, le calendrier des
 * groupes et ses deadlines. Sous le rôle de la personne connectée (src/admin/index.ts) : les règles d'accès de la base
 * (0017_envois_acces.sql) s'appliquent.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { outer } from "../read/common.ts";
import { artist, audioFile, broadcastCycle, show, submission, uploadLink, type AudioRole, type AudioStatus } from "../schema.ts";
import { addDays, blockRange, deadlineAt, lateBlock, nextDeadline, type Block, type Cycle, type Group } from "../envois/calendrier.ts";
import { newToken, readCycle } from "../envois/index.ts";
import type { NotSaved } from "./common.ts";
import { isUuid } from "./input.ts";

// ---------------------------------------------------------------------------------------------------------------
// Les liens d'envoi
// ---------------------------------------------------------------------------------------------------------------

export type AdminUploadLink = { token: string; createdAt: Date; usedAt: Date | null; profileUpdatedAt: Date | null };

/** Le lien d'envoi d'un artiste, ou null s'il n'en a pas. */
export async function uploadLinkOf(tx: Tx, artistId: string): Promise<AdminUploadLink | null> {
  if (!isUuid(artistId)) return null;
  const [row] = await tx
    .select({ token: uploadLink.token, createdAt: uploadLink.createdAt, usedAt: uploadLink.usedAt, profileUpdatedAt: uploadLink.profileUpdatedAt })
    .from(uploadLink)
    .where(eq(uploadLink.artistId, artistId))
    .limit(1);
  return row ?? null;
}

/** Crée le lien d'envoi d'un artiste, ou le remplace : l'ancien cesse de marcher. Null si l'artiste n'existe plus. */
export async function renewUploadLink(tx: Tx, artistId: string, userId: string): Promise<AdminUploadLink | null> {
  if (!isUuid(artistId)) return null;
  const [exists] = await tx.select({ id: artist.id }).from(artist).where(eq(artist.id, artistId)).limit(1);
  if (!exists) return null;
  const token = newToken();
  const [row] = await tx
    .insert(uploadLink)
    .values({ artistId, token, createdBy: userId })
    .onConflictDoUpdate({ target: uploadLink.artistId, set: { token, createdBy: userId, createdAt: sql`now()`, usedAt: null } })
    .returning({ token: uploadLink.token, createdAt: uploadLink.createdAt, usedAt: uploadLink.usedAt, profileUpdatedAt: uploadLink.profileUpdatedAt });
  return row ?? null;
}

/** Désactive le lien d'envoi d'un artiste. Faux s'il n'en avait pas. */
export async function deleteUploadLink(tx: Tx, artistId: string): Promise<boolean> {
  if (!isUuid(artistId)) return false;
  const removed = await tx.delete(uploadLink).where(eq(uploadLink.artistId, artistId)).returning({ id: uploadLink.artistId });
  return removed.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Ce qu'un show a reçu
// ---------------------------------------------------------------------------------------------------------------

export type AdminSubmission = {
  artist: { id: string; name: string } | null;
  link: string | null;
  note: string | null;
  blockStart: string | null;
  week: 1 | 2 | null;
  createdAt: Date;
  updatedAt: Date;
  /** Envoyé après la deadline de son bloc. */
  late: boolean;
  /** Le show attend encore son créneau (show provisoire, sans créneau Radio Cult). */
  waiting: boolean;
};

export type AdminAudioFile = {
  id: string;
  role: AudioRole;
  position: number | null;
  trackArtist: string | null;
  trackTitle: string | null;
  durationSeconds: number | null;
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  status: AudioStatus;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** L'envoi d'un show, ou null s'il n'en a pas. */
export async function submissionOf(tx: Tx, showId: string): Promise<AdminSubmission | null> {
  if (!isUuid(showId)) return null;
  const [row] = await tx
    .select({
      artistId: artist.id,
      artistName: artist.name,
      link: submission.link,
      note: submission.note,
      blockStart: submission.blockStart,
      week: submission.week,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      waiting: sql<boolean>`${show.radiocultEventId} is null`,
    })
    .from(submission)
    .innerJoin(show, eq(show.id, submission.showId))
    .leftJoin(artist, eq(artist.id, submission.artistId))
    .where(eq(submission.showId, showId))
    .limit(1);
  if (!row) return null;
  const cycle = row.blockStart ? await readCycle(tx) : null;
  const late = Boolean(row.blockStart && cycle && row.createdAt > deadlineAt({ deadline: addDays(row.blockStart, -cycle.deadlineDays) }));
  return {
    artist: row.artistId && row.artistName ? { id: row.artistId, name: row.artistName } : null,
    link: row.link,
    note: row.note,
    blockStart: row.blockStart,
    week: row.week === 1 || row.week === 2 ? row.week : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    late,
    waiting: row.waiting,
  };
}

/** Les fichiers son d'un show : son son, puis ses morceaux dans l'ordre. Sans ceux qui sont encore en route. */
export async function audioFilesOf(tx: Tx, showId: string): Promise<AdminAudioFile[]> {
  if (!isUuid(showId)) return [];
  return tx
    .select({
      id: audioFile.id,
      role: audioFile.role,
      position: audioFile.position,
      trackArtist: audioFile.trackArtist,
      trackTitle: audioFile.trackTitle,
      durationSeconds: audioFile.durationSeconds,
      key: audioFile.key,
      fileName: audioFile.fileName,
      mimeType: audioFile.mimeType,
      sizeBytes: audioFile.sizeBytes,
      status: audioFile.status,
      error: audioFile.error,
      sentAt: audioFile.sentAt,
      createdAt: audioFile.createdAt,
      updatedAt: audioFile.updatedAt,
    })
    .from(audioFile)
    .where(and(eq(audioFile.showId, showId), ne(audioFile.status, "uploading")))
    .orderBy(sql`${audioFile.role} = 'part'`, asc(audioFile.position));
}

/** Un fichier son arrivé, pour l'écouter ou le télécharger depuis l'admin : sa clé dans le seau et son nom d'envoi. */
export async function audioFileById(tx: Tx, id: string): Promise<{ key: string; fileName: string; showId: string | null } | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx
    .select({ key: audioFile.key, fileName: audioFile.fileName, showId: audioFile.showId })
    .from(audioFile)
    .where(and(eq(audioFile.id, id), ne(audioFile.status, "uploading")))
    .limit(1);
  return row ?? null;
}

/** Valide le son d'un show : l'équipe l'a écouté. Faux s'il n'attendait pas de validation. */
export async function approveAudio(tx: Tx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const done = await tx
    .update(audioFile)
    .set({ status: "approved" })
    .where(and(eq(audioFile.id, id), eq(audioFile.role, "main"), eq(audioFile.status, "received")))
    .returning({ id: audioFile.id });
  return done.length > 0;
}

/** Efface un fichier son (pas pendant son envoi vers SoundCloud). Rend sa clé, à effacer du seau, ou null. */
export async function deleteAudioFile(tx: Tx, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(audioFile).where(and(eq(audioFile.id, id), ne(audioFile.status, "sending"))).returning({ key: audioFile.key });
  return removed?.key ?? null;
}

/** Les clés des fichiers d'un show, à effacer du seau quand on le supprime. */
export async function audioKeysOf(tx: Tx, showIds: string[]): Promise<string[]> {
  const wanted = showIds.filter(isUuid);
  if (!wanted.length) return [];
  return (await tx.select({ key: audioFile.key }).from(audioFile).where(inArray(audioFile.showId, wanted))).map((row) => row.key);
}

// ---------------------------------------------------------------------------------------------------------------
// Ce qui attend l'équipe : les mêmes conditions pour le compte du tableau de bord et la liste où l'on arrive
// ---------------------------------------------------------------------------------------------------------------

const mainWith = (status: AudioStatus) =>
  sql`exists (select 1 from ${audioFile} af where af.show_id = ${outer(show.id)} and af.role = 'main' and af.status = ${status})`;

/** Un son reçu, que personne n'a encore écouté. */
export const awaitsReview = () => mainWith("received");
/** Un son que SoundCloud a refusé. */
export const sendFailed = () => mainWith("failed");
/** Une playlist envoyée, pas encore assemblée : ni son actif, mais des morceaux ou un lien. */
export const awaitsAssembly = () => sql`(${show.type} = 'playlist' and exists (select 1 from ${submission} su where su.show_id = ${outer(show.id)})
  and not exists (select 1 from ${audioFile} af where af.show_id = ${outer(show.id)} and af.role = 'main' and af.status <> 'uploading'))`;
/** Un envoi qui attend encore son créneau. */
export const awaitsSlot = () => sql`(${show.radiocultEventId} is null and exists (select 1 from ${submission} su where su.show_id = ${outer(show.id)}))`;

// ---------------------------------------------------------------------------------------------------------------
// Le calendrier des groupes, et ses deadlines au tableau de bord
// ---------------------------------------------------------------------------------------------------------------

/**
 * Un panneau de deadline : le bloc, et les résidents de son groupe, avec ou sans envoi pour ce bloc, et le jeton de leur
 * lien d'envoi, pour les relancer.
 */
export type DeadlinePanel = { block: Block; late: boolean; deadline: Date; residents: { id: string; name: string; sent: boolean; token: string | null }[] };

/**
 * Les panneaux du tableau de bord : le bloc dont la deadline vient de passer, tant qu'il n'a pas commencé (les
 * retardataires), puis la prochaine deadline.
 */
export async function deadlinePanels(tx: Tx, now: Date): Promise<DeadlinePanel[]> {
  const cycle = await readCycle(tx);
  if (!cycle) return [];
  const blocks: { block: Block; late: boolean }[] = [];
  const late = lateBlock(cycle, now);
  if (late) blocks.push({ block: late, late: true });
  blocks.push({ block: nextDeadline(cycle, now), late: false });
  const panels: DeadlinePanel[] = [];
  for (const { block, late: isLate } of blocks) {
    const range = blockRange(block);
    const residents = await tx
      .select({
        id: artist.id,
        name: artist.name,
        sent: sql<boolean>`exists (select 1 from ${submission} su left join ${show} s on s.id = su.show_id where su.artist_id = ${outer(artist.id)}
          and (su.block_start = ${block.start} or (s.broadcast_at >= ${range.from.toISOString()}::timestamptz and s.broadcast_at < ${range.to.toISOString()}::timestamptz)))`,
        token: uploadLink.token,
      })
      .from(artist)
      .leftJoin(uploadLink, eq(uploadLink.artistId, artist.id))
      .where(eq(artist.broadcastGroup, block.group))
      .orderBy(asc(artist.name));
    panels.push({ block, late: isLate, deadline: deadlineAt(block), residents });
  }
  return panels;
}

/** Le calendrier des groupes, ou null s'il n'est pas réglé. */
export const getCycle = (tx: Tx): Promise<Cycle | null> => readCycle(tx);

/** Règle le calendrier (un admin) : un lundi où le groupe 1 commence un bloc, la durée d'un bloc, la deadline. */
export async function saveCycle(tx: Tx, values: { group1Start: string; blockDays: number; deadlineDays: number }): Promise<{ ok: true } | NotSaved> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.group1Start) || new Date(`${values.group1Start}T00:00:00Z`).getUTCDay() !== 1) errors.group1Start = "Choisis un lundi.";
  if (![7, 14, 21, 28].includes(values.blockDays)) errors.blockDays = "Une, deux, trois ou quatre semaines.";
  if (!Number.isInteger(values.deadlineDays) || values.deadlineDays < 1 || values.deadlineDays > 60) errors.deadlineDays = "Entre 1 et 60 jours avant le bloc.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const done = await tx.update(broadcastCycle).set(values).returning({ id: broadcastCycle.id });
  if (!done.length) return { ok: false, errors: { form: "Seul un admin règle le calendrier." } };
  return { ok: true };
}

export type { Group };
