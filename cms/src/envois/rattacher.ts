/**
 * Rattacher un envoi à son créneau (cms/README.md, 9.12). Un résident envoie son émission avant que la grille soit
 * faite : elle remplit un show provisoire, sans date ni créneau. Quand la personne de l'antenne a posé le créneau dans
 * Radio Cult, l'import de nuit crée le show du créneau ; l'envoi y est alors rattaché : son contenu passe dans ce show,
 * qui garde sa date, sa durée et son créneau, et le show provisoire disparaît.
 *
 * Chaque nuit, après l'import, rattacherSeul rattache ce qui ne fait aucun doute : un envoi qui n'a qu'un créneau
 * possible (même artiste, même bloc, même semaine s'il l'a précisée), et dont ce créneau n'est réclamé par aucun autre
 * envoi. Le reste attend l'équipe (« Envois sans créneau » au tableau de bord), qui choisit parmi les créneaux proposés.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import type { Db } from "../db.ts";
import type { NotSaved } from "../admin/common.ts";
import { isUuid } from "../admin/input.ts";
import { releaseMedia } from "../admin/media.ts";
import { audioFile, show, showArtist, showTag, submission, track } from "../schema.ts";
import { blockRange, addDays } from "./calendrier.ts";
import { readCycle } from "./index.ts";

/** Les créneaux d'un artiste encore libres : un show de la grille, en brouillon, sans envoi ni son. */
const freeSlot = (artistId: string) =>
  and(
    isNotNull(show.radiocultEventId),
    eq(show.status, "draft"),
    sql`exists (select 1 from ${showArtist} sa where sa.show_id = ${show.id} and sa.artist_id = ${artistId})`,
    sql`not exists (select 1 from ${submission} su where su.show_id = ${show.id})`,
    sql`not exists (select 1 from ${audioFile} af where af.show_id = ${show.id} and af.role = 'main' and af.status <> 'uploading')`,
  );

/** Les envois qui attendent leur créneau : un show provisoire (sans créneau Radio Cult) né d'un envoi. */
async function waiting(tx: Tx, showIds?: string[]) {
  return tx
    .select({ showId: submission.showId, artistId: submission.artistId, blockStart: submission.blockStart, week: submission.week })
    .from(submission)
    .innerJoin(show, eq(show.id, submission.showId))
    .where(and(isNull(show.radiocultEventId), showIds ? inArray(submission.showId, showIds) : undefined));
}

/**
 * Les créneaux où cet envoi pourrait aller, du plus proche au plus lointain : ceux de son artiste, dans son bloc (et sa
 * semaine) s'il en a un, sinon dans les 60 jours à venir.
 */
export async function attachCandidates(tx: Tx, showId: string, { now = new Date() }: { now?: Date } = {}): Promise<{ id: string; title: string; broadcastAt: Date }[]> {
  if (!isUuid(showId)) return [];
  const [sent] = await waiting(tx, [showId]);
  if (!sent?.artistId) return [];
  const cycle = await readCycle(tx);
  const range = sent.blockStart
    ? blockRange({ start: sent.blockStart, end: addDays(sent.blockStart, (cycle?.blockDays ?? 14) - 1) }, sent.week === 1 || sent.week === 2 ? sent.week : null)
    : { from: new Date(now.getTime() - 7 * 86_400_000), to: new Date(now.getTime() + 60 * 86_400_000) };
  const rows = await tx
    .select({ id: show.id, title: show.title, broadcastAt: show.broadcastAt })
    .from(show)
    .where(and(freeSlot(sent.artistId), sql`${show.broadcastAt} >= ${range.from.toISOString()}::timestamptz`, sql`${show.broadcastAt} < ${range.to.toISOString()}::timestamptz`))
    .orderBy(asc(show.broadcastAt));
  return rows.map((row) => ({ ...row, broadcastAt: row.broadcastAt as Date }));
}

/**
 * Rattache un envoi (son show provisoire) au show d'un créneau : le titre, la description, le type, le mood, la
 * pochette, les étiquettes et la tracklist de l'envoi passent dans le créneau, qui garde sa date, sa durée, son adresse
 * et son créneau Radio Cult ; ses artistes s'ajoutent à ceux du créneau ; les fichiers et l'envoi suivent. Rend la
 * pochette remplacée, à retirer si elle ne sert plus (releaseMedia).
 */
export async function attachSubmission(tx: Tx, fromId: string, toId: string): Promise<{ ok: true; id: string; previousCover: string | null } | NotSaved> {
  if (!isUuid(fromId) || !isUuid(toId) || fromId === toId) return { ok: false, errors: { form: "Choisis un créneau." } };
  const [from] = await tx
    .select({ title: show.title, type: show.type, description: show.description, energy: show.energy, coverId: show.coverId, slot: show.radiocultEventId })
    .from(show)
    .innerJoin(submission, eq(submission.showId, show.id))
    .where(eq(show.id, fromId))
    .for("update");
  if (!from) return { ok: false, errors: { form: "Cet envoi n'existe plus : il a peut-être déjà été rattaché." } };
  if (from.slot) return { ok: false, errors: { form: "Cet envoi est déjà sur un créneau." } };
  const [to] = await tx.select({ id: show.id, coverId: show.coverId, status: show.status, slot: show.radiocultEventId }).from(show).where(eq(show.id, toId)).for("update");
  if (!to || !to.slot) return { ok: false, errors: { form: "Ce créneau n'existe plus." } };
  if (to.status !== "draft") return { ok: false, errors: { form: "Ce créneau est déjà publié : rattache l'envoi à un autre, ou dépublie-le d'abord." } };
  const [taken] = await tx.select({ id: submission.showId }).from(submission).where(eq(submission.showId, toId)).limit(1);
  const [sounded] = await tx.select({ id: audioFile.id }).from(audioFile).where(and(eq(audioFile.showId, toId), eq(audioFile.role, "main"), sql`${audioFile.status} <> 'uploading'`)).limit(1);
  if (taken || sounded) return { ok: false, errors: { form: "Ce créneau a déjà son émission." } };

  await tx
    .update(show)
    .set({
      title: from.title,
      type: from.type,
      ...(from.description ? { description: from.description } : {}),
      ...(from.energy !== null ? { energy: from.energy } : {}),
      ...(from.coverId ? { coverId: from.coverId } : {}),
    })
    .where(eq(show.id, toId));
  const tags = await tx.select({ tagId: showTag.tagId }).from(showTag).where(eq(showTag.showId, fromId));
  if (tags.length) {
    await tx.delete(showTag).where(eq(showTag.showId, toId));
    await tx.insert(showTag).values(tags.map((row) => ({ showId: toId, tagId: row.tagId })));
  }
  const tracks = await tx
    .select({ position: track.position, artist: track.artist, title: track.title, startSeconds: track.startSeconds, hopperUrl: track.hopperUrl })
    .from(track)
    .where(eq(track.showId, fromId))
    .orderBy(asc(track.position));
  if (tracks.length) {
    await tx.delete(track).where(eq(track.showId, toId));
    await tx.insert(track).values(tracks.map((line) => ({ showId: toId, ...line })));
  }
  const present = await tx.select({ artistId: showArtist.artistId, position: showArtist.position }).from(showArtist).where(eq(showArtist.showId, toId));
  const incoming = await tx.select({ artistId: showArtist.artistId }).from(showArtist).where(eq(showArtist.showId, fromId)).orderBy(asc(showArtist.position));
  let next = present.reduce((max, row) => Math.max(max, row.position + 1), 0);
  const added = incoming.filter((row) => !present.some((one) => one.artistId === row.artistId));
  if (added.length) await tx.insert(showArtist).values(added.map((row) => ({ showId: toId, artistId: row.artistId, position: next++ })));

  await tx.update(audioFile).set({ showId: toId }).where(eq(audioFile.showId, fromId));
  await tx.update(submission).set({ showId: toId }).where(eq(submission.showId, fromId));
  await tx.delete(show).where(eq(show.id, fromId));
  return { ok: true, id: toId, previousCover: from.coverId && to.coverId !== from.coverId ? to.coverId : null };
}

/**
 * Rattache tout seul ce qui ne fait aucun doute (la tâche de nuit, après l'import Radio Cult, et l'import lancé depuis
 * l'admin). Rend les rattachements faits, les pochettes remplacées, et combien d'envois attendent encore l'équipe.
 */
export async function rattacherSeul(tx: Tx, { now = new Date() }: { now?: Date } = {}): Promise<{ attached: { from: string; to: string }[]; previousCovers: string[]; left: number }> {
  const pending = (await waiting(tx)).filter((row) => row.artistId && row.blockStart);
  const options = new Map<string, string[]>();
  for (const row of pending) options.set(row.showId, (await attachCandidates(tx, row.showId, { now })).map((slot) => slot.id));
  // Un créneau réclamé par deux envois n'est pas tranché ici.
  const claims = new Map<string, number>();
  for (const slots of options.values()) for (const id of slots) claims.set(id, (claims.get(id) ?? 0) + 1);
  const attached: { from: string; to: string }[] = [];
  const previousCovers: string[] = [];
  for (const [from, slots] of options) {
    if (slots.length !== 1 || claims.get(slots[0]!) !== 1) continue;
    const done = await attachSubmission(tx, from, slots[0]!);
    if (!done.ok) continue;
    attached.push({ from, to: done.id });
    if (done.previousCover) previousCovers.push(done.previousCover);
  }
  return { attached, previousCovers, left: (await waiting(tx)).length };
}

/**
 * La tâche de nuit : rattacher seul, avec la connexion du serveur, en propriétaire des tables. Les pochettes des
 * créneaux remplacées par celles des envois sont libérées dans la même transaction : rend leurs fichiers, à effacer du
 * Storage.
 */
export const rattacherEnvois = (db: Db, options: { now?: Date } = {}) =>
  db.transaction(async (tx) => {
    const done = await rattacherSeul(tx, options);
    return { ...done, removedImages: await releaseMedia(tx, done.previousCovers) };
  });
