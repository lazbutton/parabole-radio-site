/**
 * Les vidéos de fond dans l'admin : la liste dans son ordre (les clips mis de côté compris), l'ajout d'un clip dont le
 * fichier est déjà sur le stockage, le titre, la mise en rotation, l'ordre, le remplacement du fichier et la
 * suppression. Les fichiers ne passent jamais par ici, seulement leurs adresses : le site Astro les dépose sur Vercel
 * Blob, et efface ceux qu'une suppression ou un remplacement rend inutiles.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { backgroundClip, type ContentStatus } from "../schema.ts";
import type { NotSaved } from "./common.ts";
import { isUuid, type ClipFile } from "./input.ts";

export type AdminClip = {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl: string | null;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  position: number;
  status: ContentStatus;
  createdAt: Date;
  updatedAt: Date;
};

/** Ce qu'il faut pour effacer les fichiers d'un clip du stockage. */
export type ClipFiles = { title: string; videoUrl: string; posterUrl: string | null };

const columns = {
  id: backgroundClip.id,
  title: backgroundClip.title,
  videoUrl: backgroundClip.videoUrl,
  posterUrl: backgroundClip.posterUrl,
  mimeType: backgroundClip.mimeType,
  sizeBytes: backgroundClip.sizeBytes,
  durationSeconds: backgroundClip.durationSeconds,
  width: backgroundClip.width,
  height: backgroundClip.height,
  position: backgroundClip.position,
  status: backgroundClip.status,
  createdAt: backgroundClip.createdAt,
  updatedAt: backgroundClip.updatedAt,
};

const files = { title: backgroundClip.title, videoUrl: backgroundClip.videoUrl, posterUrl: backgroundClip.posterUrl };
const gone: NotSaved = { ok: false, errors: { form: "Cette vidéo n'est plus dans la liste : elle a peut-être été supprimée." } };

/** Toutes les vidéos de fond, dans l'ordre de la liste. */
export function listClips(tx: Tx): Promise<AdminClip[]> {
  return tx.select(columns).from(backgroundClip).orderBy(asc(backgroundClip.position), asc(backgroundClip.createdAt));
}

/** Une vidéo de fond, ou null. */
export async function getClip(tx: Tx, id: string): Promise<AdminClip | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx.select(columns).from(backgroundClip).where(eq(backgroundClip.id, id)).limit(1);
  return row ?? null;
}

export type ClipAdd = { title: string; file: ClipFile; status: ContentStatus };

/** Ajoute une vidéo à la fin de la liste. */
export async function addClip(tx: Tx, { title, file, status }: ClipAdd): Promise<{ ok: true; id: string } | NotSaved> {
  const [last] = await tx.select({ position: sql<number>`coalesce(max(${backgroundClip.position}), 0)`.mapWith(Number) }).from(backgroundClip);
  const [created] = await tx
    .insert(backgroundClip)
    .values({ title, ...file, status, position: (last?.position ?? 0) + 1 })
    .returning({ id: backgroundClip.id });
  return { ok: true, id: created!.id };
}

export type ClipChange = { title?: string; status?: ContentStatus };

/** Change le titre d'une vidéo, ou la met dans la rotation (publiée) ou de côté (brouillon). */
export async function updateClip(tx: Tx, id: string, change: ClipChange): Promise<{ ok: true; id: string } | NotSaved> {
  if (!isUuid(id)) return gone;
  if (change.title === undefined && change.status === undefined) return (await getClip(tx, id)) ? { ok: true, id } : gone;
  const [updated] = await tx.update(backgroundClip).set(change).where(eq(backgroundClip.id, id)).returning({ id: backgroundClip.id });
  return updated ? { ok: true, id } : gone;
}

/** Remplace le fichier d'une vidéo, qui garde sa place, son titre et son statut. Rend les adresses de l'ancien. */
export async function replaceClipFile(tx: Tx, id: string, file: ClipFile): Promise<{ ok: true; id: string; previous: ClipFiles } | NotSaved> {
  if (!isUuid(id)) return gone;
  const [previous] = await tx.select(files).from(backgroundClip).where(eq(backgroundClip.id, id)).for("update");
  if (!previous) return gone;
  await tx.update(backgroundClip).set(file).where(eq(backgroundClip.id, id));
  return { ok: true, id, previous };
}

/**
 * Monte ou descend une vidéo d'une place. La liste est renumérotée au passage (1, 2, 3…), pour effacer les trous
 * laissés par les suppressions. Rend faux si la vidéo n'existe plus ; une vidéo déjà en tête (ou en queue) ne bouge pas.
 */
export async function moveClip(tx: Tx, id: string, direction: "up" | "down"): Promise<boolean> {
  if (!isUuid(id)) return false;
  // Verrouillées dans l'ordre de la liste : deux déplacements simultanés passent l'un après l'autre.
  const order = await tx
    .select({ id: backgroundClip.id, position: backgroundClip.position })
    .from(backgroundClip)
    .orderBy(asc(backgroundClip.position), asc(backgroundClip.createdAt))
    .for("update");
  const from = order.findIndex((clip) => clip.id === id);
  if (from < 0) return false;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to >= 0 && to < order.length) [order[from], order[to]] = [order[to]!, order[from]!];
  for (const [index, clip] of order.entries())
    if (clip.position !== index + 1) await tx.update(backgroundClip).set({ position: index + 1 }).where(eq(backgroundClip.id, clip.id));
  return true;
}

/** Supprime une vidéo de la liste. Rend son titre et les adresses de ses fichiers, à effacer du stockage, ou null. */
export async function deleteClip(tx: Tx, id: string): Promise<ClipFiles | null> {
  if (!isUuid(id)) return null;
  const [removed] = await tx.delete(backgroundClip).where(eq(backgroundClip.id, id)).returning(files);
  return removed ?? null;
}
