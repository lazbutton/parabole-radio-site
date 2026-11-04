/**
 * Écouter ou télécharger un fichier son envoyé par un résident (cms/README.md, 9.12), depuis la fiche d'un show :
 * /admin/api/son/<id> pour le lecteur, /admin/api/son/<id>?telecharger pour l'enregistrer sous son nom d'envoi (le MP3
 * à charger dans Radio Cult). Derrière la garde de l'admin, comme tout /admin ; la base vérifie encore les droits. La
 * réponse renvoie vers une adresse de lecture signée du seau, valable une heure : la fiche, elle, ne périme pas.
 */
import type { APIRoute } from "astro";
import { r2Ready, readUrl } from "../../../../lib/r2";

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!r2Ready()) return new Response("Le seau des fichiers son n'est pas branché.", { status: 503 });
  const file = await locals.admin!.audioFile(params.id ?? "");
  if (!file) return new Response("Ce fichier n'existe plus.", { status: 404 });
  const signed = await readUrl(file.key, file.fileName, { download: url.searchParams.has("telecharger") });
  return new Response(null, { status: 302, headers: { Location: signed, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
};
