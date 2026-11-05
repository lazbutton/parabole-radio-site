/**
 * La publication sur SoundCloud, côté site (cms/README.md, 9.14) : l'appli de Parabole (SOUNDCLOUD_CLIENT_ID,
 * SOUNDCLOUD_CLIENT_SECRET), et ce que le CMS demande pour envoyer une émission (cms/src/soundcloud) : le MP3 lu en
 * flux dans le seau R2, la pochette convertie en JPEG (SoundCloud ne prend ni le WebP ni l'AVIF des images du site),
 * l'adresse du site pour le lien de la description.
 */
import { mediaUrl, type AdminMedia, type PublishDeps, type SoundCloudApp } from "@parabole/cms";
import { SOUNDCLOUD_CLIENT_ID, SOUNDCLOUD_CLIENT_SECRET } from "astro:env/server";
import { mediaBaseUrl } from "./cms";
import { headSize, readUrl } from "./r2";

/** L'adresse du site en ligne, pour les liens des descriptions et l'adresse de retour de la tâche du matin. */
export const SITE_ORIGIN = new URL(import.meta.env.SITE ?? "https://parabole-radio-site.vercel.app").origin;

export const soundcloudReady = () => Boolean(SOUNDCLOUD_CLIENT_ID && SOUNDCLOUD_CLIENT_SECRET);

/**
 * L'appli, avec l'adresse de retour de ce site : celle de la production, ou celle d'un essai local. Les deux sont
 * inscrites dans l'appli chez SoundCloud. Null tant que l'appli n'est pas réglée.
 */
export function soundcloudApp(origin = SITE_ORIGIN): SoundCloudApp | null {
  if (!SOUNDCLOUD_CLIENT_ID || !SOUNDCLOUD_CLIENT_SECRET) return null;
  return { clientId: SOUNDCLOUD_CLIENT_ID, clientSecret: SOUNDCLOUD_CLIENT_SECRET, redirectUri: `${origin}/admin/soundcloud/retour` };
}

/** Le MP3 d'une émission, en flux depuis le seau, avec sa taille exacte. */
async function readAudio(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  const answer = await fetch(await readUrl(key, "son.mp3"));
  if (!answer.ok || !answer.body) throw new Error(`le seau ne rend pas le son (${answer.status})`);
  const size = Number(answer.headers.get("content-length")) || (await headSize(key));
  if (!size) throw new Error("le seau ne dit pas la taille du son");
  return { body: answer.body, size };
}

/** La pochette en JPEG, 2000 px au plus de côté ; null si elle ne se lit pas (l'émission part sans). */
async function readCover(cover: AdminMedia): Promise<Uint8Array | null> {
  const answer = await fetch(mediaUrl(mediaBaseUrl, cover.key));
  if (!answer.ok) return null;
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(Buffer.from(await answer.arrayBuffer()), { autoOrient: true })
    .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#000000" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return new Uint8Array(jpeg);
}

/** Ce que le CMS demande pour envoyer une émission. */
export const publishDeps = (app: SoundCloudApp): PublishDeps => ({ app, readAudio, readCover, siteUrl: SITE_ORIGIN });
