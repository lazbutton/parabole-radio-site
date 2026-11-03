/**
 * Les vidéos de fond et le film de la page À propos sur Vercel Blob, côté serveur (cms/README.md, 9.7 et 9.10). Une vidéo ne passe jamais
 * par une fonction Vercel (4,5 Mo au plus par requête) : le navigateur la dépose lui-même dans le magasin, avec un
 * jeton d'envoi que le serveur signe pour un seul fichier, au nom tiré ici, d'un type et d'une taille donnés, valable
 * une demi-heure. Le jeton du magasin (BLOB_READ_WRITE_TOKEN) ne quitte pas le serveur.
 *
 * Seuls les fichiers de ce magasin, rangés sous fond/ (les clips) ou a-propos/ (le film), sont acceptés et effacés :
 * jamais un clip livré avec le site (public/), jamais une adresse d'ailleurs.
 */
import { del, head } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { BLOB_READ_WRITE_TOKEN } from "astro:env/server";

/** Les dossiers du magasin : les vidéos de fond, et le film de la page À propos. */
const FOLDERS = ["fond", "a-propos"] as const;
export type BlobFolder = (typeof FOLDERS)[number];

/** Chaque visiteur télécharge les vidéos : 40 Mo au plus, quatre fois le plus lourd des clips d'origine. */
export const MAX_VIDEO_BYTES = 40_000_000;
/**
 * Le film de À propos ne part qu'au clic d'un visiteur : 100 Mo au plus. Chaque lecture le télécharge pourtant sur le
 * transfert de Vercel Blob, compté au mois (10 Go en Hobby) : plus il est léger, mieux c'est.
 */
export const MAX_FILM_BYTES = 100_000_000;
const MAX_POSTER_BYTES = 2_000_000;

/** Les types acceptés, et l'extension du fichier dans le magasin. */
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };
const POSTER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp" };
export const POSTER_TYPE_LIST = Object.keys(POSTER_TYPES);

/** L'identifiant du magasin, lu dans son jeton : vercel_blob_rw_<magasin>_<secret>. */
const storeId = () => (BLOB_READ_WRITE_TOKEN ?? "").split("_")[3]?.toLowerCase() ?? "";

/** L'envoi est branché : le magasin Vercel Blob est relié au projet. */
export const blobReady = () => Boolean(storeId());

/** Un fichier de ce magasin, sous fond/ ou a-propos/ (ou sous le seul dossier `folder`) ? */
export function isOurFile(url: string, folder?: BlobFolder): boolean {
  const store = storeId();
  if (!store) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === `${store}.public.blob.vercel-storage.com` &&
      (folder ? [folder] : FOLDERS).some((name) => parsed.pathname.startsWith(`/${name}/`))
    );
  } catch {
    return false;
  }
}

/**
 * Le jeton d'envoi d'un fichier : la vidéo d'un clip (ou du film de À propos, `folder`) ou son image d'attente. Ou la
 * raison du refus.
 */
export async function uploadTicket(
  kind: "video" | "poster",
  type: string,
  size: number,
  folder: BlobFolder = "fond",
): Promise<{ pathname: string; token: string } | { error: string }> {
  const extension = (kind === "video" ? VIDEO_TYPES : POSTER_TYPES)[type];
  if (!extension) return { error: kind === "video" ? "Une vidéo MP4 ou WebM seulement." : "L'image d'attente doit être un JPEG ou un WebP." };
  const maximum = kind === "poster" ? MAX_POSTER_BYTES : folder === "a-propos" ? MAX_FILM_BYTES : MAX_VIDEO_BYTES;
  if (!(size > 0) || size > maximum) return { error: kind === "video" ? `La vidéo dépasse ${maximum / 1_000_000} Mo.` : "L'image d'attente est trop lourde." };
  const pathname = `${folder}/${crypto.randomUUID()}.${extension}`;
  const token = await generateClientTokenFromReadWriteToken({
    token: BLOB_READ_WRITE_TOKEN,
    pathname,
    allowedContentTypes: [type],
    maximumSizeInBytes: maximum,
    validUntil: Date.now() + 30 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
    // Un nom ne sert qu'une fois : les navigateurs et le réseau de Vercel peuvent garder le fichier un an.
    cacheControlMaxAge: 365 * 24 * 60 * 60,
  });
  return { pathname, token };
}

/** Le fichier est bien arrivé dans le magasin, avec l'un de ces types : sa taille réelle, ou null. */
export async function uploaded(url: string, types: string[]): Promise<{ size: number } | null> {
  if (!isOurFile(url)) return null;
  try {
    const found = await head(url, { token: BLOB_READ_WRITE_TOKEN });
    return types.includes(found.contentType) ? { size: found.size } : null;
  } catch {
    return null;
  }
}

/**
 * Efface du magasin des fichiers devenus inutiles (du seul dossier `folder`, s'il est donné). Les autres adresses sont
 * laissées ; un échec n'empêche rien.
 */
export async function removeFiles(urls: (string | null | undefined)[], folder?: BlobFolder): Promise<void> {
  const ours = urls.filter((url): url is string => typeof url === "string" && isOurFile(url, folder));
  if (!ours.length) return;
  try {
    await del(ours, { token: BLOB_READ_WRITE_TOKEN });
  } catch (failure) {
    console.error("Vercel Blob : effacement impossible", ours, failure);
  }
}
