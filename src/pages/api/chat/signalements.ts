/**
 * POST /api/chat/signalements : signaler un message à la régie. Le corps : { message, motif }. Il faut un pseudo à
 * l'antenne ; au seuil de la régie, le message est brouillé en attendant qu'elle le voie (src/chat/). Rend { ok: true }
 * ou { ok: false, raison }.
 */
import type { APIRoute } from "astro";
import { antenneDuSite, corpsDe, jetonDe, memeOrigine, reponse } from "../../../lib/antenne";

export const prerender = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  if (!memeOrigine(context)) return reponse({ error: "origine" }, 403);
  const corps = await corpsDe(context);
  if (!corps || typeof corps.message !== "string" || !UUID.test(corps.message)) return reponse({ error: "saisie" }, 400);
  try {
    const motif = typeof corps.motif === "string" ? corps.motif : "autre";
    return reponse(await (await antenneDuSite()).signaler({ jeton: jetonDe(context), messageId: corps.message, motif }));
  } catch (panne) {
    console.error("api/chat/signalements : le signalement a échoué", panne);
    return reponse({ error: "indisponible" }, 502);
  }
};
