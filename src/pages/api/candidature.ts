/**
 * POST /api/candidature : la page /candidater dépose une candidature (cms/README.md, 9.17). Le corps, en JSON : les
 * champs du formulaire, le jeton Turnstile (en ligne seulement, là où le site a ses clés), et « site », un champ piège
 * caché que seul un robot remplit : il reçoit un faux succès, rien n'est écrit. Le serveur revérifie tout avec les règles
 * de la page (createCandidatures().deposer), puis écrit en propriétaire des tables. Rien n'est gardé de l'auditeur
 * d'autre que ce qu'il a écrit : son adresse IP ne sert qu'à la vérification Turnstile.
 *
 * Réponses : 200 { ok: true } ; 422 { ok: false, errors } (par champ, ou « form ») ; 409 (type complet, candidature déjà
 * en cours) ; 429 (trop dans l'heure) ; 403 (autre origine, vérification refusée) ; 400 (corps illisible) ; 503 (base
 * injoignable). Jamais en cache.
 */
import type { APIRoute } from "astro";
import { corpsDe, ipDe, memeOrigine, reponse, verificationHumaine } from "../../lib/antenne";
import { ACTION_CANDIDATURE, candidaturesDuSite } from "../../lib/candidatures";

export const prerender = false;

const texte = (valeur: unknown, max: number) => (typeof valeur === "string" ? valeur.slice(0, max) : "");

export const POST: APIRoute = async (context) => {
  if (!memeOrigine(context)) return reponse({ ok: false, errors: { form: "Cette candidature ne vient pas du site de Parabole." } }, 403);
  const corps = await corpsDe(context);
  if (!corps) return reponse({ ok: false, errors: { form: "La candidature n'a pas pu être lue : réessaie." } }, 400);
  // Le champ piège : un robot le remplit, et croit que c'est passé.
  if (texte(corps.site, 300).trim()) return reponse({ ok: true });

  const humain = verificationHumaine(corps.turnstile, ipDe(context), context.url.hostname, ACTION_CANDIDATURE);
  if (humain && !(await humain()))
    return reponse({ ok: false, verification: true, errors: { form: "La vérification anti-robots n'est pas passée. Tes réponses sont gardées : réessaie." } }, 403);

  try {
    const depot = await (await candidaturesDuSite()).deposer({
      type: texte(corps.type, 20),
      prete: texte(corps.prete, 10),
      frequence: texte(corps.frequence, 20),
      nom: texte(corps.nom, 400),
      ville: texte(corps.ville, 200),
      instagram: texte(corps.instagram, 300),
      email: texte(corps.email, 300),
      idee: texte(corps.idee, 4000),
      lien: texte(corps.lien, 1000),
      styles: Array.isArray(corps.styles) ? corps.styles.slice(0, 10).map((style) => texte(style, 80)) : [],
    });
    if (!depot.ok) return reponse({ ok: false, errors: depot.errors }, depot.status);
    console.log(`Candidatures : une candidature reçue (${texte(corps.type, 20)}).`);
    return reponse({ ok: true });
  } catch (panne) {
    console.error("candidature : la base ne répond pas", panne);
    return reponse({ ok: false, errors: { form: "La candidature n'a pas pu partir : la base ne répond pas. Tes réponses sont gardées, réessaie dans un moment." } }, 503);
  }
};
