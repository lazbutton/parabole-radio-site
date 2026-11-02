/**
 * POST /api/chat/messages : passer à l'antenne. Le corps : { pseudo, couleur, texte, turnstile? }. Le pseudo d'abord
 * (un nouveau pseudo naît, ou l'ancien change), puis le message : la modération du CMS décide (src/chat/). Rend
 * { issue: "antenne" | "attente", message } ou { issue: "refuse", raison, code? } ; code « humain » : il faut la
 * vérification Turnstile, que la page fait puis renvoie. Un nouveau pseudo reçoit son cookie, même si le message est
 * refusé.
 */
import { estCouleur } from "@parabole/cms";
import type { APIRoute } from "astro";
import { antenneDuSite, corpsDe, ipDe, jetonDe, memeOrigine, poserJeton, reponse, verificationHumaine } from "../../../lib/antenne";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!memeOrigine(context)) return reponse({ error: "origine" }, 403);
  const corps = await corpsDe(context);
  if (!corps || typeof corps.pseudo !== "string" || typeof corps.texte !== "string") return reponse({ error: "saisie" }, 400);
  const ip = ipDe(context);
  try {
    const issue = await (
      await antenneDuSite()
    ).envoyer({
      jeton: jetonDe(context),
      ip,
      pseudo: corps.pseudo.slice(0, 60),
      couleur: estCouleur(corps.couleur) ? corps.couleur : "white",
      texte: corps.texte.slice(0, 1000),
      humain: verificationHumaine(corps.turnstile, ip),
    });
    if (issue.jeton) poserJeton(context, issue.jeton);
    const { jeton: _jeton, ...rendu } = issue;
    return reponse(rendu);
  } catch (panne) {
    console.error("api/chat/messages : l'envoi a échoué", panne);
    return reponse({ error: "indisponible" }, 502);
  }
};
