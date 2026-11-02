/**
 * GET /api/chat/moi : ce qu'un auditeur sait de lui-même, d'après son cookie : son pseudo et sa couleur, une exclusion
 * ou un bannissement en cours, et ce que sont devenus ses messages de la dernière heure (la page 888 apprend ainsi
 * qu'un message en attente a été rejeté). Sans pseudo à l'antenne : { moi: null }.
 */
import type { APIRoute } from "astro";
import { antenneDuSite, jetonDe, reponse } from "../../../lib/antenne";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  try {
    return reponse({ moi: await (await antenneDuSite()).moi(jetonDe(context)) });
  } catch (panne) {
    console.error("api/chat/moi : illisible", panne);
    return reponse({ error: "indisponible" }, 502);
  }
};
