/**
 * Les fichiers son de la page d'envoi, dans le navigateur : le dépôt dans le seau R2 à l'adresse que le serveur signe
 * (PUT, avec sa progression), le débit d'un MP3 (pour demander du 320 kbit/s), la durée d'un morceau, et les appels aux
 * routes de la page (/api/envoi/…).
 */
import type { FieldErrors } from "@parabole/cms";

/** Un appel à une route de la page, le jeton du lien en plus. Une panne devient un message, jamais une page perdue. */
export async function call<T>(jeton: string, action: string, body: Record<string, unknown> = {}): Promise<T | { ok: false; errors: FieldErrors }> {
  try {
    const response = await fetch(`/api/envoi/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ jeton, ...body }) });
    if ((response.headers.get("content-type") ?? "").includes("application/json")) return (await response.json()) as T;
    return { ok: false, errors: { form: "Le site n'a pas répondu comme prévu. Réessaie dans un instant." } };
  } catch {
    return { ok: false, errors: { form: "Pas de connexion. Vérifie le réseau, puis réessaie : ta saisie est toujours là." } };
  }
}

/**
 * Dépose un fichier dans le seau, à l'adresse signée, avec le type signé. XMLHttpRequest plutôt que fetch : il donne la
 * progression de l'envoi. Un envoi annulé lève une AbortError.
 */
export function putAudio(url: string, file: Blob, mime: string, onPercent: (percent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", mime);
    request.upload.onprogress = (event) => event.lengthComputable && onPercent(Math.round((event.loaded / event.total) * 100));
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Le dépôt a été refusé (${request.status}). Réessaie.`)));
    request.onerror = () => reject(new Error("La connexion a coupé pendant l'envoi. Réessaie : le fichier repart du début."));
    request.onabort = () => reject(new DOMException("Envoi annulé", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

/** Les débits des MP3 (MPEG-1 couche III), en kbit/s, par index ; MPEG-2 pour les fréquences basses. */
const MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/**
 * Le débit d'un MP3 à débit constant, lu dans l'en-tête de sa première trame ; null pour un débit variable (en-tête
 * « Xing ») ou un fichier illisible : on ne prévient alors de rien.
 */
export async function mp3Kbps(file: File): Promise<number | null> {
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  let at = 0;
  // Les étiquettes ID3v2 d'abord : leur taille est écrite sur 4 octets de 7 bits.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) at = 10 + (((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f));
  for (; at < bytes.length - 4; at++) {
    if (bytes[at] !== 0xff || (bytes[at + 1]! & 0xe0) !== 0xe0) continue;
    const version = (bytes[at + 1]! >> 3) & 0x03;
    const layer = (bytes[at + 1]! >> 1) & 0x03;
    const index = bytes[at + 2]! >> 4;
    if (layer !== 1 || version === 1 || index === 0 || index === 15) continue;
    const frame = new TextDecoder("latin1").decode(bytes.subarray(at, at + 200));
    if (frame.includes("Xing") || frame.includes("VBRI")) return null;
    return (version === 3 ? MPEG1 : MPEG2)[index] ?? null;
  }
  return null;
}

/** La durée d'un fichier son, en secondes, lue par le navigateur ; null s'il ne sait pas le lire. */
export function audioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration) : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}
