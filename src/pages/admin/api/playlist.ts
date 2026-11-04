/**
 * La liste d'une playlist, pour l'outil d'assemblage (cms/README.md, 9.13) : POST, avec l'adresse de la playlist
 * (« url »), réponse en JSON : la plateforme, le titre et les morceaux (artiste, titre, durée), ou pourquoi on ne peut
 * pas la lire. Derrière la garde de l'admin, comme tout /admin.
 */
import type { APIRoute } from "astro";
import { readPlaylist } from "../../../lib/admin/playlists";
import { json } from "../../../lib/admin/views";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const data = await request.formData();
  const url = String(data.get("url") ?? "").slice(0, 600);
  if (!url.trim()) return json({ ok: false, error: "Donne l'adresse de la playlist." }, 422);
  const answer = await readPlaylist(url);
  return json(answer, answer.ok ? 200 : 422);
};
