/**
 * GET /api/chat : l'état de l'antenne libre (ouverte, mode lent, différé, messages au bandeau, liens) et les 50 derniers
 * messages passés à l'antenne depuis le dernier vidage, du plus ancien au plus récent. Le bandeau et la page 888 s'en
 * servent à l'ouverture et après une coupure ; la suite arrive par le canal temps réel. Rien en cache : un message
 * brouillé ne doit pas revenir. Base injoignable : 502, et le site garde le bandeau d'origine.
 */
import type { APIRoute } from "astro";
import { antenneDuSite, reponse } from "../../../lib/antenne";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const antenne = await antenneDuSite();
    const [etat, messages] = await Promise.all([antenne.etat(), antenne.historique()]);
    return reponse({ etat, messages });
  } catch (panne) {
    console.error("api/chat : l'antenne est illisible", panne);
    return reponse({ error: "indisponible" }, 502);
  }
};
