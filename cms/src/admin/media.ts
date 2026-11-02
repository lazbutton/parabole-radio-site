/**
 * Les images dans l'admin (README, 9.3) : un fichier envoyé sur Supabase Storage, inscrit avec ses versions WebP, son
 * texte alternatif et son crédit ; sa place sur une fiche (la photo d'un artiste, la pochette d'un show) ; le retrait
 * de ceux qui ne servent plus. Les fichiers ne passent jamais par ici, seulement leurs clés : le site Astro les prépare
 * et les dépose (src/lib/admin/storage.ts), puis efface du Storage ceux que le retrait lui rend.
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { outer } from "../read/common.ts";
import { artist, event, eventPhoto, media, show, type MediaVariant } from "../schema.ts";
import { versionOf, type NotSaved } from "./common.ts";
import { isUuid, type MediaText } from "./input.ts";

/** Le dossier des images envoyées depuis l'admin, dans le seau « media » : les seules que l'admin efface. */
export const UPLOAD_FOLDER = "images/";

export type AdminMedia = { id: string; key: string; width: number | null; height: number | null; alt: string; credit: string | null; variants: MediaVariant[] };

export const mediaColumns = { id: media.id, key: media.key, width: media.width, height: media.height, alt: media.alt, credit: media.credit, variants: media.variants };

/** Une image, ou null. */
export async function getMedia(tx: Tx, id: string | null | undefined): Promise<AdminMedia | null> {
  if (!isUuid(id)) return null;
  const [row] = await tx.select(mediaColumns).from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

/**
 * Une image envoyée, ses versions déjà déposées dans le seau « media » : la plus grande (sa clé, son poids, ses
 * dimensions), et les plus petites pour le srcset du site (cms/src/read/common.ts, toImage).
 */
export type MediaUpload = MediaText & { key: string; sizeBytes: number; width: number; height: number; variants: MediaVariant[] };

/** Inscrit une image envoyée. Elle ne sert encore à rien : seule l'équipe la voit tant qu'aucun contenu publié ne la montre. */
export async function addMedia(tx: Tx, file: MediaUpload): Promise<{ ok: true; media: AdminMedia } | NotSaved> {
  if (![file.key, ...file.variants.map((variant) => variant.key)].every((key) => key.startsWith(UPLOAD_FOLDER)))
    return { ok: false, errors: { image: "Ce fichier n'a pas été envoyé depuis l'admin." } };
  const [created] = await tx
    .insert(media)
    .values({ key: file.key, mimeType: "image/webp", sizeBytes: file.sizeBytes, width: file.width, height: file.height, alt: file.alt, credit: file.credit, variants: file.variants })
    .returning(mediaColumns);
  return { ok: true, media: created! };
}

/** Change le texte alternatif et le crédit d'une image, partout où elle sert. */
export async function describeMedia(tx: Tx, id: string, text: MediaText): Promise<{ ok: true; media: AdminMedia } | NotSaved> {
  const gone: NotSaved = { ok: false, errors: { image: "Cette image n'existe plus." } };
  if (!isUuid(id)) return gone;
  const [updated] = await tx.update(media).set(text).where(eq(media.id, id)).returning(mediaColumns);
  return updated ? { ok: true, media: updated } : gone;
}

/** Les places d'une image sur une fiche : la photo d'un artiste, la pochette d'un show. */
export type MediaSlot = "photo" | "cover";

const SLOTS = {
  photo: {
    gone: "Cet artiste n'existe plus : il a peut-être été supprimé.",
    read: (tx: Tx, id: string) => tx.select({ fileId: artist.photoId, version: versionOf(artist.updatedAt) }).from(artist).where(eq(artist.id, id)).for("update"),
    write: (tx: Tx, id: string, fileId: string | null) =>
      tx.update(artist).set({ photoId: fileId }).where(eq(artist.id, id)).returning({ version: versionOf(artist.updatedAt) }),
  },
  cover: {
    gone: "Ce show n'existe plus : il a peut-être été supprimé.",
    read: (tx: Tx, id: string) => tx.select({ fileId: show.coverId, version: versionOf(show.updatedAt) }).from(show).where(eq(show.id, id)).for("update"),
    write: (tx: Tx, id: string, fileId: string | null) =>
      tx.update(show).set({ coverId: fileId }).where(eq(show.id, id)).returning({ version: versionOf(show.updatedAt) }),
  },
} satisfies Record<MediaSlot, unknown>;

export type MediaPlace = {
  /** L'artiste ou le show. */
  id: string;
  /** L'image à y mettre ; null pour la retirer. */
  mediaId: string | null;
  /** Le jeton de version de la fiche ouverte à l'écran (src/admin/common.ts). */
  version?: string;
};

/**
 * Met une image à sa place sur une fiche, ou l'en retire. Rend l'image d'avant, à retirer si elle ne sert plus
 * (releaseMedia). La fiche change de version : si l'écran avait la dernière, il reçoit la nouvelle, et peut enregistrer
 * le reste de sa saisie sans fausse alerte ; sinon `version` est null, et son prochain enregistrement signalera, comme
 * d'habitude, qu'on a modifié la fiche entre-temps.
 */
export async function placeMedia(tx: Tx, slot: MediaSlot, { id, mediaId, version }: MediaPlace): Promise<{ ok: true; previous: string | null; version: string | null } | NotSaved> {
  const { gone, read, write } = SLOTS[slot];
  if (!isUuid(id)) return { ok: false, errors: { form: gone } };
  if (mediaId !== null && !(await getMedia(tx, mediaId))) return { ok: false, errors: { image: "Cette image n'existe plus : envoie-la de nouveau." } };
  const [current] = await read(tx, id);
  if (!current) return { ok: false, errors: { form: gone } };
  const upToDate = version !== undefined && version === current.version;
  if (current.fileId === mediaId) return { ok: true, previous: null, version: upToDate ? current.version : null };
  const [updated] = await write(tx, id, mediaId);
  return { ok: true, previous: current.fileId, version: upToDate ? updated!.version : null };
}

/**
 * Retire les images qui ne servent plus à rien : ni photo, ni pochette, ni visuel, ni galerie. Seulement celles envoyées
 * depuis l'admin (rangées sous images/) : les exemples et ce qui viendrait d'ailleurs restent. Rend les clés de leurs
 * versions, à effacer du seau « media », avec l'original de chacune dans le seau « originaux ».
 */
export async function releaseMedia(tx: Tx, ids: (string | null | undefined)[]): Promise<string[]> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (!wanted.length) return [];
  const id = outer(media.id);
  const removed = await tx
    .delete(media)
    .where(
      and(
        inArray(media.id, wanted),
        like(media.key, `${UPLOAD_FOLDER}%`),
        sql`not exists (select 1 from ${artist} a where a.photo_id = ${id})`,
        sql`not exists (select 1 from ${show} s where s.cover_id = ${id})`,
        sql`not exists (select 1 from ${event} e where e.visual_id = ${id})`,
        sql`not exists (select 1 from ${eventPhoto} p where p.media_id = ${id})`,
      ),
    )
    .returning({ key: media.key, variants: media.variants });
  return removed.flatMap((file) => [file.key, ...file.variants.map((variant) => variant.key)]);
}
