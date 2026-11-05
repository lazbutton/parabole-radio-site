/**
 * Le seau Cloudflare R2 des émissions envoyées par les résidents (cms/README.md, 9.12), côté serveur. Un fichier son ne
 * passe jamais par une fonction Vercel (4,5 Mo au plus par requête) : le navigateur le dépose lui-même, par une adresse
 * PUT que le serveur signe pour une seule clé et un seul type, valable 6 heures (l'envoi doit commencer avant). Le
 * serveur vérifie ensuite qu'il est bien arrivé (HEAD), signe des adresses de lecture d'une heure pour l'écouter ou le
 * télécharger depuis l'admin, et efface ce qui ne sert plus. Les clés du jeton d'API (R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY) ne quittent pas le serveur.
 *
 * Seules les clés des envois (audio/AAAA/MM/<uuid>.<ext>) sont lues ou effacées : rien d'autre dans le seau.
 */
import { AUDIO_KEY, dispositionOf } from "@parabole/cms/envois";
import { AwsClient } from "aws4fetch";
import { R2_ACCESS_KEY_ID, R2_ACCOUNT_ID, R2_BUCKET, R2_ENDPOINT, R2_SECRET_ACCESS_KEY } from "astro:env/server";

/** Le délai pour commencer un envoi : un gros fichier sur une connexion lente doit avoir le temps de partir. */
const UPLOAD_SECONDS = 6 * 3600;
/** Une adresse d'écoute : le temps d'écouter le set dans l'admin, sans recharger la fiche. */
const READ_SECONDS = 3600;

let client: AwsClient | undefined;
const aws = () => (client ??= new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" }));

/** Le seau est branché : son compte (ou un point d'accès local), son nom, et les clés du jeton. */
export const r2Ready = () => Boolean(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && (R2_ENDPOINT || R2_ACCOUNT_ID));

/** L'adresse d'un objet : https://<compte>.r2.cloudflarestorage.com/<seau>/<clé>, ou sous le point d'accès local. */
function objectUrl(key: string): URL {
  const base = (R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
  return new URL(`${base}/${R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`);
}

/** L'adresse signée d'un envoi : PUT, de ce type seulement (l'en-tête Content-Type est signé), valable 6 heures. */
export async function uploadUrl(key: string, mime: string): Promise<string> {
  const url = objectUrl(key);
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_SECONDS));
  const signed = await aws().sign(new Request(url, { method: "PUT", headers: { "Content-Type": mime } }), { aws: { signQuery: true, allHeaders: true } });
  return signed.url;
}

/** L'adresse signée d'une lecture : pour écouter le fichier dans l'admin, ou le télécharger sous son nom d'envoi. */
export async function readUrl(key: string, fileName: string, { download = false } = {}): Promise<string> {
  const url = objectUrl(key);
  url.searchParams.set("X-Amz-Expires", String(READ_SECONDS));
  url.searchParams.set("response-content-disposition", dispositionOf(fileName, download));
  const signed = await aws().sign(new Request(url), { aws: { signQuery: true } });
  return signed.url;
}

/** La taille d'un fichier arrivé dans le seau ; null s'il n'y est pas (envoi interrompu, jamais commencé). */
export async function headSize(key: string): Promise<number | null> {
  if (!AUDIO_KEY.test(key)) return null;
  try {
    const answer = await aws().fetch(objectUrl(key), { method: "HEAD" });
    if (!answer.ok) return null;
    const size = Number(answer.headers.get("content-length"));
    return Number.isFinite(size) && size > 0 ? size : null;
  } catch (failure) {
    console.error("R2 : lecture impossible", key, failure);
    return null;
  }
}

/** Efface des fichiers du seau. Les autres adresses sont laissées ; un échec n'empêche rien, il est noté. */
export async function removeFiles(keys: (string | null | undefined)[]): Promise<void> {
  const ours = [...new Set(keys.filter((key): key is string => typeof key === "string" && AUDIO_KEY.test(key)))];
  if (!ours.length || !r2Ready()) return;
  await Promise.all(
    ours.map(async (key) => {
      try {
        const answer = await aws().fetch(objectUrl(key), { method: "DELETE" });
        if (!answer.ok && answer.status !== 404) console.error("R2 : effacement refusé", key, answer.status);
      } catch (failure) {
        console.error("R2 : effacement impossible", key, failure);
      }
    }),
  );
}
