/**
 * La page d'envoi d'un résident (/envoyer/<jeton>, cms/README.md, 9.12), en POST, corps et réponses en JSON. Le jeton
 * du lien va dans le corps ; sans lui, rien ne se passe. Hors de /admin : aucune session, le jeton seul ouvre la page.
 *
 *   - page : la page à jour (ses blocs, ses émissions) ;
 *   - fiche : une émission à corriger ;
 *   - fichier : un fichier son annoncé (nom, poids, son rôle) ; le serveur signe son dépôt dans le seau R2 ;
 *   - deposer : la fiche et les fichiers arrivés dans le seau (le serveur le vérifie), en une seule fois ;
 *   - fiche-artiste : la bio et la photo de l'artiste.
 */
import type { EnvoiForm } from "@parabole/cms";
import type { APIContext, APIRoute } from "astro";
import { corpsDe, memeOrigine } from "../../../lib/antenne";
import { removeImages } from "../../../lib/admin/storage";
import { envoisDuSite, pageData, reply, sheetData } from "../../../lib/envois";
import { headSize, r2Ready, removeFiles, uploadUrl } from "../../../lib/r2";

export const prerender = false;

const DEAD = "Ce lien ne marche plus : demande-en un nouveau à l'équipe.";

const text = (value: unknown, max = 25_000) => (typeof value === "string" ? value.slice(0, max) : "");
const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);
const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** La fiche envoyée par la page, remise en forme ; le CMS la vérifie ensuite champ par champ. */
function readForm(raw: unknown): EnvoiForm {
  const form = record(raw);
  return {
    showId: text(form.showId, 64),
    version: text(form.version, 40),
    type: text(form.type, 20),
    blockStart: text(form.blockStart, 10),
    week: text(form.week, 1),
    title: text(form.title, 400),
    description: text(form.description),
    energy: text(form.energy, 2),
    tags: list(form.tags, 60).map((value) => text(value, 80)),
    tracks: list(form.tracks, 400).map((value) => {
      const line = record(value);
      return { start: text(line.start, 20), artist: text(line.artist, 400), title: text(line.title, 400), hopperUrl: text(line.hopperUrl, 600) };
    }),
    pasted: text(form.pasted),
    note: text(form.note, 4000),
    link: text(form.link, 600),
    main: text(form.main, 64),
    parts: list(form.parts, 80).map((value) => {
      const part = record(value);
      return { id: text(part.id, 64), artist: text(part.artist, 400), title: text(part.title, 400), duration: text(String(part.duration ?? ""), 12) };
    }),
    cover: text(form.cover, 64),
  };
}

async function handle(context: APIContext, body: Record<string, unknown>): Promise<Response> {
  const jeton = text(body.jeton, 64);
  const envois = await envoisDuSite();
  switch (context.params.action) {
    case "page": {
      const page = await envois.ouvrir(jeton);
      return page ? reply({ ok: true, page: pageData(jeton, page) }) : reply({ ok: false, errors: { form: DEAD } }, 404);
    }

    case "fiche": {
      const fiche = await envois.fiche(jeton, text(body.showId, 64));
      return fiche ? reply({ ok: true, sheet: sheetData(fiche) }) : reply({ ok: false, errors: { form: "Cette émission n'est plus modifiable : elle est peut-être déjà partie." } }, 404);
    }

    case "fichier": {
      if (!r2Ready()) return reply({ ok: false, errors: { file: "L'envoi des fichiers n'est pas encore branché : préviens l'équipe." } }, 503);
      const role = body.role === "part" ? "part" : "main";
      const ticket = await envois.preparerFichier(jeton, { role, fileName: text(body.fileName, 300), size: Number(body.size), showId: text(body.showId, 64) || undefined });
      if (!ticket.ok) return reply({ ok: false, errors: { file: ticket.error } }, 422);
      return reply({ ok: true, id: ticket.id, mime: ticket.mime, url: await uploadUrl(ticket.key, ticket.mime) });
    }

    case "deposer": {
      const form = readForm(body.form);
      // Les fichiers annoncés comme arrivés : leur taille réelle, lue dans le seau.
      const pending = await envois.enAttente(jeton, [form.main, ...form.parts.map((part) => part.id)].filter(Boolean));
      const arrived = new Map<string, number>();
      await Promise.all(
        pending.map(async (file) => {
          const size = await headSize(file.key);
          if (size) arrived.set(file.id, size);
        }),
      );
      const done = await envois.deposer(jeton, form, arrived);
      if (!done.ok) return reply(done, 422);
      await removeFiles(done.removedKeys);
      await removeImages(done.removedImages);
      return reply({ ok: true, showId: done.showId });
    }

    case "fiche-artiste": {
      const change: { bio?: string; photo?: string | null } = {};
      if (typeof body.bio === "string") change.bio = text(body.bio);
      if (body.photo === null || typeof body.photo === "string") change.photo = body.photo === null ? null : text(body.photo, 64);
      const done = await envois.majFiche(jeton, change);
      if (!done.ok) return reply(done, 422);
      await removeImages(done.removedImages);
      return reply({ ok: true });
    }
  }
  return reply({ ok: false, errors: { form: "Action inconnue." } }, 404);
}

export const POST: APIRoute = async (context) => {
  if (!memeOrigine(context)) return reply({ ok: false, errors: { form: "Requête refusée." } }, 403);
  const body = await corpsDe(context);
  if (!body) return reply({ ok: false, errors: { form: "Requête illisible." } }, 400);
  try {
    return await handle(context, body);
  } catch (failure) {
    console.error(`api/envoi/${context.params.action} : échec`, failure);
    return reply({ ok: false, errors: { form: "Le site ne répond pas pour l'instant. Réessaie dans un moment." } }, 502);
  }
};
