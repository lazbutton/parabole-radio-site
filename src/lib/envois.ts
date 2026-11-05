/**
 * La page d'envoi d'un résident (/envoyer/<jeton>, cms/README.md, 9.12), côté serveur : le CMS des envois sur la base
 * du site, et ses données mises en forme pour la page (src/components/envoi/types.ts). Le jeton est dans l'adresse :
 * ni cache, ni moteur de recherche, ni adresse transmise aux sites tiers (Referrer-Policy).
 */
import { addDays, createEnvois, dayLabel, daysBetween, parisDay, type EnvoiFiche, type EnvoiPage, type Envois } from "@parabole/cms";
import type { EnvoiPageData, EnvoiSheet } from "../components/envoi/types";
import { megabytes, parisDateTime } from "./admin/format";
import { mediaView } from "./admin/views";
import { database } from "./cms";
import { r2Ready } from "./r2";
import { MAX_IMAGE_BYTES, storageReady } from "./admin/storage";

export const envoisDuSite = async (): Promise<Envois> => createEnvois(await database());

/** Les en-têtes d'une page ou d'une réponse qui porte le jeton. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

export const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...PRIVATE_HEADERS } });

/** Ce que devient le son d'une émission, en mots pour l'artiste. */
export const STATUS_WORDS: Record<string, string> = {
  received: "Reçu, en attente d'écoute",
  approved: "Validé par l'équipe",
  sending: "En route vers SoundCloud",
  sent: "Publié sur SoundCloud",
  failed: "À revoir par l'équipe",
};

export function pageData(jeton: string, page: EnvoiPage, now = new Date()): EnvoiPageData {
  const today = parisDay(now);
  /** Le bloc d'une émission : celui de son envoi, sinon celui où tombe sa diffusion (un créneau de la grille). */
  const blockOf = (item: EnvoiPage["items"][number]) => {
    if (item.envoi?.blockStart) return item.envoi.blockStart;
    const day = item.broadcastAt ? parisDay(item.broadcastAt) : null;
    return (day && page.blocks.find(({ block }) => block.start <= day && day <= block.end)?.block.start) ?? null;
  };
  return {
    jeton,
    artist: { name: page.artist.name, group: page.artist.group, bio: page.artist.bio ?? "", photo: mediaView(page.artist.photo) },
    blocks: page.blocks.map(({ block, late }) => ({
      start: block.start,
      label: `du ${dayLabel(block.start)} au ${dayLabel(block.end)}`,
      deadline: block.deadline,
      deadlineLabel: dayLabel(block.deadline),
      late,
      daysLeft: daysBetween(today, block.deadline),
      weeks: [`semaine du ${dayLabel(block.start, false)}`, `semaine du ${dayLabel(addDays(block.start, 7), false)}`],
    })),
    rows: page.items.map((item) => ({
      showId: item.showId,
      title: item.title,
      type: item.type,
      when: item.broadcastAt ? parisDateTime(item.broadcastAt) : null,
      slot: item.slot,
      status: item.envoi?.main ? (STATUS_WORDS[item.envoi.main.status] ?? null) : item.envoi?.parts ? `${item.envoi.parts} morceau${item.envoi.parts > 1 ? "x" : ""} reçu${item.envoi.parts > 1 ? "s" : ""}` : null,
      block: item.envoi?.blockStart ? `bloc du ${dayLabel(item.envoi.blockStart, false)}` : null,
      blockStart: blockOf(item),
      sent: Boolean(item.envoi),
      locked: item.envoi?.main?.status === "sending" || item.envoi?.main?.status === "sent",
    })),
    facets: page.choices.facets,
    tags: page.choices.tags,
    audioReady: r2Ready(),
    images: { ready: storageReady(), maxBytes: MAX_IMAGE_BYTES },
  };
}

export function sheetData(fiche: EnvoiFiche): EnvoiSheet {
  return {
    showId: fiche.showId,
    version: fiche.version,
    title: fiche.title,
    type: fiche.type,
    when: fiche.broadcastAt ? parisDateTime(fiche.broadcastAt) : null,
    slot: fiche.slot,
    description: fiche.description,
    energy: fiche.energy === null ? "" : String(fiche.energy),
    tags: fiche.tags,
    tracks: fiche.tracks,
    cover: mediaView(fiche.cover),
    note: fiche.note,
    link: fiche.link,
    blockStart: fiche.blockStart,
    week: fiche.week ? (String(fiche.week) as "1" | "2") : "",
    main: fiche.main ? { fileName: fiche.main.fileName, status: STATUS_WORDS[fiche.main.status] ?? fiche.main.status, size: fiche.main.sizeBytes ? megabytes(fiche.main.sizeBytes) : "" } : null,
    parts: fiche.parts.map((part) => ({ id: part.id, artist: part.artist, title: part.title, duration: part.durationSeconds, fileName: part.fileName, size: part.sizeBytes ? megabytes(part.sizeBytes) : "" })),
  };
}
