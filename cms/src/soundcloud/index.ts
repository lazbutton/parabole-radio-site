/**
 * La publication sur SoundCloud (cms/README.md, 9.14). Le lendemain matin de sa diffusion, une émission validée part
 * sur le compte SoundCloud de Parabole (la tâche planifiée /api/cron/soundcloud), puis sa page est publiée sur le site,
 * ce qui la montre aussi chez ses artistes. « Publier maintenant », dans sa fiche, fait la même chose tout de suite.
 *
 *   - aPublier : les émissions dont le son est validé, qui ont une date (un créneau de la grille), dont la diffusion
 *     est finie (son début plus sa durée, deux heures si elle manque), et qui n'ont pas encore de piste ;
 *   - prendre : le son passe « en route vers SoundCloud », s'il était validé, en échec, ou en route depuis trop
 *     longtemps (l'envoi s'est interrompu) ; jamais deux fois ;
 *   - envoyer : le MP3 va du seau à SoundCloud en flux (POST /tracks), avec le titre, les artistes, la description (le
 *     texte, la setlist, le lien de la page), les étiquettes, la date de diffusion et la pochette en JPEG ; puis la
 *     piste est inscrite sur l'émission (identifiant, adresse sans paramètres de suivi, durée si elle manquait, lue
 *     dans le MP3 lui-même pendant l'envoi), sa page publiée, et les morceaux d'une playlist assemblée effacés (rendus
 *     pour le seau). Un échec passe en « failed », avec sa raison, et n'est pas réessayé seul ;
 *   - completerDurees : la durée des émissions parties sans elle, demandée à SoundCloud (la tâche du matin).
 * Les accès (le seau, la pochette, le réseau) sont passés par l'appelant : le site en production, de faux dans les tests.
 */
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getShow, type AdminShow } from "../admin/shows.ts";
import type { AdminMedia } from "../admin/media.ts";
import type { Db } from "../db.ts";
import { parisDay } from "../envois/calendrier.ts";
import { STUCK_SENDING_MS } from "../envois/fichiers.ts";
import { audioFile, show } from "../schema.ts";
import { formatTimecode } from "../tracklist.ts";
import { keepHead, mp3Seconds } from "./mp3.ts";
import { multipart, type Part } from "./multipart.ts";
import { API_URL, jetonSoundCloud, SoundCloudError, type SoundCloudApp } from "./oauth.ts";

export { authorizeUrl, challengeOf, compteSoundCloud, delierSoundCloud, jetonSoundCloud, pkce, relierSoundCloud, SoundCloudError, type SoundCloudApp } from "./oauth.ts";
export { keepHead, mp3Seconds } from "./mp3.ts";
export { multipart, type Part } from "./multipart.ts";

/** Ce que l'envoi demande au site : l'appli SoundCloud, le réseau, le MP3 dans le seau, la pochette en JPEG, son adresse. */
export type PublishDeps = {
  app: SoundCloudApp;
  fetcher?: typeof fetch;
  /** Le MP3 dans le seau : son flux et sa taille exacte. */
  readAudio(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }>;
  /** La pochette en JPEG (SoundCloud ne prend ni le WebP ni l'AVIF), ou null. */
  readCover(cover: AdminMedia): Promise<Uint8Array | null>;
  /** L'adresse du site, sans « / » final : la description renvoie vers la page de l'émission. */
  siteUrl: string;
  now?: () => Date;
};

/** Une émission prise pour SoundCloud : son son, sa clé dans le seau. */
export type Job = { showId: string; fileId: string; key: string };

export type Published = { ok: true; showId: string; trackId: string; url: string; removedKeys: string[] } | { ok: false; showId: string; error: string };

/** La durée supposée d'une émission sans durée : deux heures. */
const DEFAULT_LENGTH = 7200;

/**
 * Les émissions à publier ce matin, de la plus ancienne diffusion à la plus récente : son validé, une date de
 * diffusion, la diffusion finie, pas encore de piste SoundCloud (une piste posée à la main n'est pas doublée).
 */
export async function aPublier(db: Db, now = new Date(), limit = 20): Promise<string[]> {
  const rows = await db
    .select({ id: show.id })
    .from(show)
    .innerJoin(audioFile, and(eq(audioFile.showId, show.id), eq(audioFile.role, "main"), eq(audioFile.status, "approved")))
    .where(
      and(
        sql`${show.broadcastAt} is not null`,
        // En texte ISO : Drizzle laisse postgres-js passer une date telle quelle dans du SQL écrit à la main.
        sql`${show.broadcastAt} + make_interval(secs => coalesce(${show.durationSeconds}, ${DEFAULT_LENGTH})) <= ${now.toISOString()}::timestamptz`,
        sql`${show.soundcloudTrackId} is null`,
      ),
    )
    .orderBy(show.broadcastAt)
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Prend une émission pour SoundCloud : son son, validé, en échec ou bloqué en route (STUCK_SENDING_MS), passe « en
 * route ». Null sinon (déjà pris, parti, à écouter).
 */
export async function prendre(db: Db, showId: string, now = new Date()): Promise<Job | null> {
  const [taken] = await db
    .update(audioFile)
    .set({ status: "sending", error: null })
    .where(
      and(
        eq(audioFile.showId, showId),
        eq(audioFile.role, "main"),
        or(inArray(audioFile.status, ["approved", "failed"]), and(eq(audioFile.status, "sending"), lt(audioFile.updatedAt, new Date(now.getTime() - STUCK_SENDING_MS)))),
      ),
    )
    .returning({ fileId: audioFile.id, key: audioFile.key });
  return taken ? { showId, ...taken } : null;
}

/** Le Markdown d'une description en texte simple : SoundCloud n'affiche ni gras ni liens, il rend les adresses cliquables. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** La description de la piste : le texte de l'émission, sa setlist minutée, et le lien de sa page sur le site. */
export function descriptionOf(current: AdminShow, siteUrl: string): string {
  const lines = current.tracks.map((track) => `${track.startSeconds !== null ? `${formatTimecode(track.startSeconds)} ` : ""}${[track.artist, track.title].filter(Boolean).join(" – ")}`);
  const parts = [plainText(current.description ?? ""), lines.length ? `Tracklist\n${lines.join("\n")}` : "", `Sur Parabole Radio : ${siteUrl}/emissions/${current.slug}`];
  return parts.filter(Boolean).join("\n\n").slice(0, 8000);
}

/** Les étiquettes de la piste, à la manière de SoundCloud : séparées par des espaces, entre guillemets si elles en ont. */
export function tagListOf(current: AdminShow): string {
  return current.tags.map((tag) => (/\s/.test(tag.name) ? `"${tag.name.replace(/"/g, "")}"` : tag.name)).join(" ");
}

/** Les champs de l'envoi, sans le son ni la pochette. */
export function trackFields(current: AdminShow, siteUrl: string, sharing: "public" | "private"): Part[] {
  const fields: [string, string][] = [
    ["track[title]", current.title],
    ["track[artist]", current.artists.map((one) => one.name).join(" & ")],
    ["track[description]", descriptionOf(current, siteUrl)],
    ["track[sharing]", sharing],
    ["track[downloadable]", "false"],
    ["track[genre]", current.tags[0]?.name ?? ""],
    ["track[tag_list]", tagListOf(current)],
    ["track[release_date]", current.broadcastAt ? parisDay(current.broadcastAt) : ""],
  ];
  return fields.filter(([, value]) => value !== "").map(([name, value]) => ({ name, value }));
}

/** Pourquoi SoundCloud refuse, en mots pour l'équipe. */
function refusal(status: number, body: Record<string, unknown>): string {
  const errors = Array.isArray(body.errors) ? (body.errors as Record<string, unknown>[]) : [];
  const said = [errors[0]?.error_message, body.message, body.error].find((value): value is string => typeof value === "string" && value.trim() !== "");
  if (status === 401) return "SoundCloud refuse l'accès : un admin relie le compte de nouveau depuis l'accueil.";
  if (status === 403) return `SoundCloud refuse l'envoi${said ? ` : ${said}` : ""}. Le compte a-t-il encore de la place pour publier (Artist Pro) ?`;
  if (status === 413) return "Le fichier est trop lourd pour SoundCloud.";
  if (status === 429) return "SoundCloud limite les envois pour l'instant : réessaie plus tard.";
  if (status >= 500) return `SoundCloud ne répond pas (${status}) : réessaie plus tard.`;
  return `SoundCloud refuse la piste (${status})${said ? ` : ${said}` : ""}.`;
}

/**
 * L'adresse d'une piste sans les paramètres de suivi que l'API y ajoute (utm_…). Le jeton d'une piste privée est dans
 * le chemin (/s-…) : il reste.
 */
export function cleanPermalink(url: string): string {
  try {
    const clean = new URL(url);
    for (const name of [...clean.searchParams.keys()]) if (name.startsWith("utm_")) clean.searchParams.delete(name);
    clean.hash = "";
    return clean.href;
  } catch {
    return url;
  }
}

/** L'identifiant d'une piste rendue par SoundCloud : de son URN (« soundcloud:tracks:123 »), sinon son id. */
export function trackIdOf(body: Record<string, unknown>): string | null {
  const urn = typeof body.urn === "string" ? /^soundcloud:tracks:(\d+)$/.exec(body.urn)?.[1] : undefined;
  if (urn) return urn;
  return typeof body.id === "number" || (typeof body.id === "string" && /^\d+$/.test(body.id)) ? String(body.id) : null;
}

/**
 * Envoie l'émission prise sur SoundCloud, puis l'inscrit et publie sa page (en public seulement, et s'il y a une date
 * de diffusion). Rend la piste, ou la raison de l'échec, déjà notée sur le son.
 */
export async function envoyer(db: Db, job: Job, deps: PublishDeps, { sharing = "public" }: { sharing?: "public" | "private" } = {}): Promise<Published> {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now?.() ?? new Date();
  try {
    const current = await db.transaction((tx) => getShow(tx, job.showId));
    if (!current) throw new SoundCloudError("Cette émission n'existe plus.");
    const token = await jetonSoundCloud(db, deps.app, { fetcher, now });
    const audio = await deps.readAudio(job.key);
    // Le début du son est gardé au passage : il donne la durée, que SoundCloud ne rend pas tant qu'il transcode.
    const sound = keepHead(audio.body);
    const artwork = current.cover ? await deps.readCover(current.cover).catch(() => null) : null;
    const parts: Part[] = [
      ...trackFields(current, deps.siteUrl, sharing),
      { name: "track[asset_data]", fileName: `${current.slug}.mp3`, type: "audio/mpeg", size: audio.size, open: () => sound.stream },
      ...(artwork ? [{ name: "track[artwork_data]", fileName: `${current.slug}.jpg`, type: "image/jpeg", size: artwork.byteLength, open: () => artwork } satisfies Part] : []),
    ];
    const { body, length, type } = multipart(parts);
    let answer: Response;
    try {
      answer = await fetcher(`${API_URL}/tracks`, {
        method: "POST",
        headers: { Accept: "application/json; charset=utf-8", Authorization: `OAuth ${token}`, "Content-Type": type, "Content-Length": String(length) },
        body,
        duplex: "half",
      } as RequestInit);
    } catch (failure) {
      throw new SoundCloudError(`La connexion à SoundCloud a coupé pendant l'envoi${failure instanceof Error && failure.message ? ` (${failure.message})` : ""} : réessaie.`);
    }
    const reply = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
    if (!answer.ok) throw new SoundCloudError(refusal(answer.status, reply));
    const trackId = trackIdOf(reply);
    const url = typeof reply.permalink_url === "string" ? cleanPermalink(reply.permalink_url) : null;
    if (!trackId || !url) throw new SoundCloudError("SoundCloud a pris le son sans rendre sa piste : vérifie le compte avant de réessayer.");
    const reported = typeof reply.duration === "number" && reply.duration > 0 ? Math.round(reply.duration / 1000) : null;
    const seconds = mp3Seconds(sound.head(), audio.size) ?? reported;
    const removedKeys = await db
      .transaction(async (tx) => {
        await tx.update(audioFile).set({ status: "sent", sentAt: now, error: null }).where(eq(audioFile.id, job.fileId));
        await tx
          .update(show)
          .set({
            soundcloudTrackId: trackId,
            soundcloudUrl: url,
            durationSeconds: sql`coalesce(${show.durationSeconds}, ${seconds})`,
            ...(sharing === "public" && current.broadcastAt ? { status: "published" as const } : {}),
          })
          .where(eq(show.id, job.showId));
        // Les morceaux d'une playlist assemblée n'ont plus d'usage : le fichier assemblé reste, eux partent.
        const parts = await tx.delete(audioFile).where(and(eq(audioFile.showId, job.showId), eq(audioFile.role, "part"))).returning({ key: audioFile.key });
        return parts.map((part) => part.key);
      })
      .catch((failure: unknown) => {
        // La piste est sur SoundCloud : on le dit, avec son adresse, pour ne pas l'envoyer une seconde fois.
        throw new SoundCloudError(`La piste est sur SoundCloud (${url}) mais la fiche n'a pas pu être mise à jour : reporte l'identifiant ${trackId} à la main. (${failure instanceof Error ? failure.message : String(failure)})`);
      });
    return { ok: true, showId: job.showId, trackId, url, removedKeys };
  } catch (failure) {
    const error = failure instanceof SoundCloudError ? failure.message : `L'envoi vers SoundCloud a échoué : ${failure instanceof Error ? failure.message : String(failure)}`;
    await db.update(audioFile).set({ status: "failed", error: error.slice(0, 500) }).where(and(eq(audioFile.id, job.fileId), eq(audioFile.status, "sending")));
    return { ok: false, showId: job.showId, error };
  }
}

/**
 * La durée des émissions parties sur SoundCloud sans elle (un son que le MP3 ne disait pas, SoundCloud qui transcodait
 * encore) : demandée à SoundCloud, une piste après l'autre, des plus récentes aux plus anciennes (une piste introuvable
 * ne bloque pas les nouvelles). Seulement celles que le site a envoyées, et qui n'ont pas de durée. Rend le nombre
 * d'émissions complétées.
 */
export async function completerDurees(db: Db, deps: Pick<PublishDeps, "app" | "fetcher" | "now">, limit = 20): Promise<number> {
  const fetcher = deps.fetcher ?? fetch;
  const rows = await db
    .select({ id: show.id, trackId: show.soundcloudTrackId })
    .from(show)
    .innerJoin(audioFile, and(eq(audioFile.showId, show.id), eq(audioFile.role, "main"), eq(audioFile.status, "sent")))
    .where(and(sql`${show.soundcloudTrackId} is not null`, sql`${show.durationSeconds} is null`))
    .orderBy(desc(audioFile.sentAt))
    .limit(limit);
  if (!rows.length) return 0;
  const token = await jetonSoundCloud(db, deps.app, { fetcher, now: deps.now?.() ?? new Date() });
  let filled = 0;
  for (const row of rows) {
    const answer = await fetcher(`${API_URL}/tracks/soundcloud:tracks:${row.trackId}`, { headers: { Accept: "application/json; charset=utf-8", Authorization: `OAuth ${token}` } });
    const body = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
    const seconds = answer.ok && typeof body.duration === "number" && body.duration > 0 ? Math.round(body.duration / 1000) : null;
    if (!seconds) continue;
    await db.update(show).set({ durationSeconds: sql`coalesce(${show.durationSeconds}, ${seconds})` }).where(eq(show.id, row.id));
    filled++;
  }
  return filled;
}

/** Prend puis envoie une émission ; null si elle n'était pas à prendre. */
export async function publier(db: Db, showId: string, deps: PublishDeps, options: { sharing?: "public" | "private" } = {}): Promise<Published | null> {
  const job = await prendre(db, showId);
  return job ? envoyer(db, job, deps, options) : null;
}
