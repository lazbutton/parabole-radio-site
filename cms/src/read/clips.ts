/** Les vidéos de fond pour le site : celles de la rotation, dans l'ordre de la liste de l'admin. */
import { asc, eq } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { backgroundClip } from "../schema.ts";

/** Un clip de la rotation : l'adresse de la vidéo, son titre (vide : le numéro seul) et son image d'attente. */
export type ClipCard = { src: string; title: string; poster: string | null };

export function listBackgroundClips(tx: Tx): Promise<ClipCard[]> {
  return tx
    .select({ src: backgroundClip.videoUrl, title: backgroundClip.title, poster: backgroundClip.posterUrl })
    .from(backgroundClip)
    .where(eq(backgroundClip.status, "published"))
    .orderBy(asc(backgroundClip.position), asc(backgroundClip.createdAt));
}
