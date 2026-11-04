/**
 * Les fichiers son des envois (cms/README.md, 9.12) : ce qu'on accepte, jusqu'à quel poids, sous quel nom dans le
 * seau R2. Rien que du calcul : ce module sert aussi dans le navigateur (@parabole/cms/envois), pour refuser un
 * fichier avant de l'envoyer.
 */

/** Le son d'un set ou d'un podcast : un MP3, sous 750 Mo, la limite de Radio Cult, qui le diffusera. */
export const MAX_MAIN_BYTES = 750_000_000;
/** Un morceau d'une playlist à assembler : l'assemblage en refait un MP3, tous les formats courants passent. */
export const MAX_PART_BYTES = 200_000_000;
export const MAX_PARTS = 60;
export const MAX_PLAYLIST_BYTES = 2_000_000_000;
/** Le débit demandé pour le son d'un show ; un débit plus bas est signalé, pas refusé. */
export const WANTED_KBPS = 320;

export type AudioRole = "main" | "part";

/** Les formats, par extension : les navigateurs donnent un type peu fiable (souvent vide pour un FLAC ou un AIFF). */
const TYPES: Record<string, { mime: string; ext: string }> = {
  mp3: { mime: "audio/mpeg", ext: "mp3" },
  m4a: { mime: "audio/mp4", ext: "m4a" },
  wav: { mime: "audio/wav", ext: "wav" },
  wave: { mime: "audio/wav", ext: "wav" },
  aif: { mime: "audio/aiff", ext: "aiff" },
  aiff: { mime: "audio/aiff", ext: "aiff" },
  flac: { mime: "audio/flac", ext: "flac" },
};

/** Les extensions acceptées pour un son de show, et pour un morceau : pour l'attribut accept d'un champ de fichier. */
export const MAIN_ACCEPT = ".mp3";
export const PART_ACCEPT = ".mp3,.m4a,.wav,.aif,.aiff,.flac";

/** Le type et l'extension rangée d'un fichier, d'après son nom ; null pour un format refusé à ce rôle. */
export function audioTypeOf(fileName: string, role: AudioRole): { mime: string; ext: string } | null {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  const type = ext ? TYPES[ext] : undefined;
  if (!type) return null;
  if (role === "main" && type.ext !== "mp3") return null;
  return type;
}

/** Pourquoi un fichier est refusé, en une phrase pour la personne qui l'envoie ; null s'il passe. */
export function audioRefusal(fileName: string, size: number, role: AudioRole): string | null {
  if (!audioTypeOf(fileName, role)) return role === "main" ? "Il faut un MP3 : exporte ton émission en MP3 320 kbit/s." : "Un morceau en MP3, M4A, WAV, AIFF ou FLAC seulement.";
  const maximum = role === "main" ? MAX_MAIN_BYTES : MAX_PART_BYTES;
  if (!(size > 0)) return "Ce fichier est vide.";
  if (size > maximum) return `Ce fichier dépasse ${maximum / 1_000_000} Mo.`;
  return null;
}

/** Une clé du seau : « audio/2026/11/<uuid>.mp3 ». */
export const AUDIO_KEY = /^audio\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|m4a|wav|aiff|flac)$/;

export function audioKey(id: string, ext: string, at: Date): string {
  return `audio/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${id}.${ext}`;
}

/**
 * L'en-tête Content-Disposition d'un fichier à écouter (inline) ou à télécharger (attachment) sous son nom d'envoi :
 * une version ASCII pour les vieux navigateurs, et la vraie en UTF-8.
 */
export function dispositionOf(fileName: string, download: boolean): string {
  const name = fileName.replace(/[\r\n"\\/]/g, " ").trim().slice(0, 180) || "son";
  const ascii = name.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ") || "son";
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * L'artiste et le titre d'un morceau d'après son nom de fichier : « 03 - Artiste - Titre.mp3 », « Artiste – Titre ».
 * Sans tiret, tout va dans le titre.
 */
export function trackFromFileName(fileName: string): { artist: string; title: string } {
  const base = fileName
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/_/g, " ")
    .replace(/^\s*\d{1,3}\s*[-.)_]?\s+/, "")
    .trim();
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0]!.trim(), title: parts.slice(1).join(" - ").trim() };
  return { artist: "", title: base };
}
