/**
 * Les images de l'admin sur Supabase Storage, côté serveur (cms/README.md, 9.3). Une image ne passe jamais par une
 * fonction Vercel (4,5 Mo au plus par requête) : le navigateur dépose l'original dans le seau privé « originaux », à
 * une adresse que le serveur signe pour ce seul fichier (valable 2 heures). Le serveur relit ensuite l'original, le
 * recadre en carré pour une photo d'artiste ou une pochette, en tire les versions WebP du site (400, 800 et 1600 px de
 * large, sans les métadonnées, position GPS comprise) et les dépose dans le seau public « media ».
 *
 * La clé secrète (SUPABASE_SECRET_KEY) ne quitte pas le serveur et ne sert qu'aux fichiers : les contenus, et la table
 * media, s'écrivent sous le rôle du membre. Seuls les fichiers rangés par l'admin sont effacés : les versions sous
 * images/, et leurs originaux.
 */
import { UPLOAD_FOLDER, type MediaUpload } from "@parabole/cms";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";
import { SUPABASE_SECRET_KEY } from "astro:env/server";

const ORIGINALS = "originaux";
const VERSIONS = "media";

/** Une photo d'appareil passe ; au-delà, c'est autre chose qu'une photo. Le seau « originaux » a la même limite. */
export const MAX_IMAGE_BYTES = 25_000_000;
/** Les types acceptés, et l'extension de l'original. */
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
export const IMAGE_TYPE_LIST = Object.keys(IMAGE_TYPES);
/** Les largeurs des versions : 400 et 800 pour les grilles (srcset), 1600 pour le fond de la page d'un artiste. */
const WIDTHS = [400, 800, 1600];
/** Le plus petit côté accepté, recadrage fait : en dessous, l'image serait floue partout. */
export const MIN_IMAGE_SIDE = 200;
/** Au-delà de 80 millions de pixels, l'image est refusée avant d'être décodée : la fonction n'a pas la mémoire. */
const MAX_PIXELS = 80_000_000;

/** Un original : « 2026/11/<uuid>.jpg » dans le seau « originaux ». */
const ORIGINAL = /^(\d{4})\/(\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpg|png|webp|avif)$/;
/** Une version : « images/2026/11/<uuid>-800.webp » dans le seau « media ». */
const VERSION = new RegExp(`^${UPLOAD_FOLDER}(\\d{4})/(\\d{2})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\\d+\\.webp$`);

/** L'envoi est branché : l'adresse du projet Supabase et sa clé secrète sont là. */
export const storageReady = () => Boolean(PUBLIC_SUPABASE_URL && SUPABASE_SECRET_KEY);

let client: SupabaseClient | undefined;
const bucket = (name: string) => (client ??= createClient(PUBLIC_SUPABASE_URL!, SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })).storage.from(name);

const UNREACHABLE = "Le stockage des images ne répond pas. Réessaie dans un instant.";

/** L'adresse d'envoi signée d'un original, pour ce seul fichier, d'un type et d'un poids permis. Ou la raison du refus. */
export async function uploadTicket(type: string, size: number): Promise<{ path: string; url: string } | { error: string }> {
  const extension = IMAGE_TYPES[type];
  if (!extension) return { error: "Une image JPEG, PNG, WebP ou AVIF seulement." };
  if (!(size > 0) || size > MAX_IMAGE_BYTES) return { error: `L'image dépasse ${MAX_IMAGE_BYTES / 1_000_000} Mo : réduis-la avant de l'envoyer.` };
  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await bucket(ORIGINALS).createSignedUploadUrl(path);
  if (error) {
    console.error("Storage : adresse d'envoi impossible", error);
    return { error: UNREACHABLE };
  }
  return { path, url: data.signedUrl };
}

/** Le cadre d'une image : une photo d'artiste ou une pochette est carrée ; le reste garde son cadre. */
export type Shape = "square" | "free";

/**
 * La partie de l'image à garder. En carré : le plus grand carré, placé le long du côté long selon `focus` (0 : en haut
 * ou à gauche, 0,5 : au milieu, 1 : en bas ou à droite), comme l'écran l'a montré. Sinon, toute l'image.
 */
export function frameOf(width: number, height: number, shape: Shape, focus: number): { left: number; top: number; width: number; height: number } {
  if (shape === "free" || width === height) return { left: 0, top: 0, width, height };
  const side = Math.min(width, height);
  const offset = Math.round((Math.max(width, height) - side) * (Number.isFinite(focus) ? Math.min(1, Math.max(0, focus)) : 0.5));
  return width > height ? { left: offset, top: 0, width: side, height: side } : { left: 0, top: offset, width: side, height: side };
}

/** Les largeurs des versions d'une image : jamais agrandie ; une petite image donne sa plus grande version à sa taille. */
export function widthsOf(width: number): number[] {
  const largest = Math.min(width, WIDTHS.at(-1)!);
  return [...WIDTHS.filter((candidate) => candidate < largest), largest];
}

type Version = { width: number; height: number; body: Buffer };

/** Les versions WebP d'une image, de la plus petite à la plus grande. Ou la raison du refus. */
export async function versionsOf(input: Buffer, shape: Shape, focus: number): Promise<{ versions: Version[] } | { error: string }> {
  // Chargé ici seulement : les autres pages de l'admin, qui lisent ce module, ne paient pas le module natif. S'il
  // manque à la fonction (un binaire que Vercel n'aurait pas embarqué), l'écran le dit au lieu d'une erreur 500.
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch (failure) {
    console.error("sharp : module introuvable", failure);
    return { error: "Le serveur ne sait pas préparer les images pour l'instant (sharp manque). Préviens l'équipe technique." };
  }
  // Tournée d'après son orientation EXIF, comme le navigateur l'a montrée ; décodée en entier, sans tolérer un fichier abîmé.
  const read = () => sharp(input, { autoOrient: true, limitInputPixels: MAX_PIXELS, failOn: "error" });
  let size: { width: number; height: number };
  try {
    size = (await read().metadata()).autoOrient;
  } catch {
    return { error: "Ce fichier n'est pas une image lisible." };
  }
  if (size.width * size.height > MAX_PIXELS) return { error: `L'image est trop grande : ${MAX_PIXELS / 1_000_000} millions de pixels au plus. Réduis-la avant de l'envoyer.` };
  const frame = frameOf(size.width, size.height, shape, focus);
  if (Math.min(frame.width, frame.height) < MIN_IMAGE_SIDE) return { error: `L'image est trop petite : ${MIN_IMAGE_SIDE} pixels de côté au moins.` };
  try {
    const versions: Version[] = [];
    // Une lecture par version, l'une après l'autre : la mémoire de la fonction ne garde qu'une image décodée à la fois.
    for (const width of widthsOf(frame.width)) {
      const { data, info } = await read().extract(frame).resize({ width }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      versions.push({ width: info.width, height: info.height, body: data });
    }
    return { versions };
  } catch (failure) {
    console.error("sharp : versions impossibles", failure);
    return { error: "Cette image n'a pas pu être préparée. Essaie de l'exporter en JPEG." };
  }
}

/**
 * Prépare l'image d'un original déposé : ses versions WebP, déposées dans le seau « media » sous un nom qui ne sert
 * qu'une fois (images/2026/11/<uuid>-<largeur>.webp), gardées un an par les navigateurs et le CDN. Rend de quoi
 * l'inscrire dans la table media (il manque son texte), et les clés déposées, à effacer si l'inscription échoue.
 * L'original reste dans « originaux », sauf s'il n'est pas une image.
 */
export async function prepare(path: string, shape: Shape, focus: number): Promise<{ file: Omit<MediaUpload, "alt" | "credit">; keys: string[] } | { error: string }> {
  const parts = ORIGINAL.exec(path);
  if (!parts) return { error: "Cet envoi est introuvable. Recommence." };
  const [, year, month, id] = parts;
  const { data, error } = await bucket(ORIGINALS).download(path);
  if (error) return { error: "L'image envoyée est introuvable sur le stockage. Recommence l'envoi." };
  const made = await versionsOf(Buffer.from(await data.arrayBuffer()), shape, focus);
  if ("error" in made) {
    await discardOriginal(path);
    return made;
  }
  const keyOf = (width: number) => `${UPLOAD_FOLDER}${year}/${month}/${id}-${width}.webp`;
  const keys: string[] = [];
  for (const version of made.versions) {
    const key = keyOf(version.width);
    // Sans écraser : un second traitement du même envoi échoue ici, sans toucher aux fichiers du premier.
    const sent = await bucket(VERSIONS).upload(key, version.body, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (sent.error) {
      console.error("Storage : version non déposée", key, sent.error);
      await removeImages(keys);
      return { error: UNREACHABLE };
    }
    keys.push(key);
  }
  const largest = made.versions.at(-1)!;
  return {
    keys,
    file: {
      key: keyOf(largest.width),
      sizeBytes: largest.body.length,
      width: largest.width,
      height: largest.height,
      variants: made.versions.slice(0, -1).map((version) => ({ width: version.width, key: keyOf(version.width) })),
    },
  };
}

/** Efface un original déposé qui ne donnera pas d'image (son texte est refusé…). Rien d'autre que les originaux. */
export async function discardOriginal(path: string): Promise<void> {
  if (!ORIGINAL.test(path) || !storageReady()) return;
  const { error } = await bucket(ORIGINALS).remove([path]);
  if (error) console.error("Storage : original non effacé", path, error);
}

/**
 * Efface du Storage les fichiers d'images retirées (cms : releaseMedia) : leurs versions, et l'original de chacune.
 * Les autres clés sont laissées ; un échec n'empêche rien, il est noté dans les journaux.
 */
export async function removeImages(keys: string[]): Promise<void> {
  const versions = keys.filter((key) => VERSION.test(key));
  if (!versions.length || !storageReady()) return;
  // L'original porte le nom de ses versions (2026/11/<uuid>), mais pas son extension, qui n'est pas gardée : on efface
  // toutes celles possibles, le Storage ignore les fichiers absents.
  const stems = new Set(versions.map((key) => VERSION.exec(key)!.slice(1, 4).join("/")));
  const originals = [...stems].flatMap((stem) => Object.values(IMAGE_TYPES).map((extension) => `${stem}.${extension}`));
  try {
    const results = await Promise.all([bucket(VERSIONS).remove(versions), bucket(ORIGINALS).remove(originals)]);
    for (const { error } of results) if (error) console.error("Storage : effacement impossible", versions, error);
  } catch (failure) {
    console.error("Storage : effacement impossible", versions, failure);
  }
}
