/**
 * L'envoi d'une candidature depuis /candidater (cms/README.md, 9.17), en POST, corps et réponses en JSON (la photo, en
 * formulaire, comme l'envoi des images de la page d'envoi). Hors de /admin : aucune session. Le jeton du dossier, que
 * la page reçoit en l'ouvrant, va dans le corps de chaque requête ; sans lui, rien n'est signé ni écrit.
 *
 *   - dossier : les écrans 1 et 2 (l'émission, l'artiste). Ouvrir un dossier passe par la vérification Turnstile (là où
 *     le site a ses clés) ; avec le jeton d'un dossier encore ouvert, il est mis à jour. « site », un champ piège caché
 *     que seul un robot remplit, reçoit un faux jeton : rien n'est écrit ;
 *   - son : un MP3 annoncé (nom, poids) ; le serveur inscrit sa ligne et signe son dépôt dans le seau R2. Un nouveau
 *     son remplace le précédent, effacé du seau ;
 *   - photo : upload (le dépôt signé de l'original dans le Storage), finalize (la photo recadrée en carré, ses versions,
 *     inscrite au dossier), retirer ;
 *   - deposer : l'écran 3 et l'envoi, une fois le son arrivé en entier dans le seau (le serveur le vérifie).
 *
 * Rien n'est gardé de la personne d'autre que ce qu'elle envoie : son adresse IP ne sert qu'à Turnstile. Réponses : 200 ;
 * 422 (champ par champ, ou « form ») ; 404 (dossier expiré) ; 409 (type complet, candidature déjà en cours) ; 429 (trop
 * dans l'heure) ; 403 (autre site, vérification refusée) ; 400 (corps illisible) ; 503 (base, seau ou Storage injoignable).
 * Jamais en cache.
 */
import { randomBytes } from "node:crypto";
import type { CandidatureForm } from "@parabole/cms";
import type { APIContext, APIRoute } from "astro";
import { prepare, removeImages, storageReady, uploadTicket } from "../../../lib/admin/storage";
import { mediaView } from "../../../lib/admin/views";
import { corpsDe, ipDe, memeOrigine, reponse, verificationHumaine } from "../../../lib/antenne";
import { ACTION_CANDIDATURE, candidaturesDuSite } from "../../../lib/candidatures";
import { headSize, r2Ready, removeFiles, uploadUrl } from "../../../lib/r2";

export const prerender = false;

const texte = (valeur: unknown, max: number) => (typeof valeur === "string" ? valeur.slice(0, max) : "");

/** Le formulaire envoyé par la page, remis en forme ; le CMS le vérifie ensuite champ par champ. */
function lireForm(brut: unknown): CandidatureForm {
  const form = brut && typeof brut === "object" ? (brut as Record<string, unknown>) : {};
  return {
    type: texte(form.type, 20),
    frequence: texte(form.frequence, 20),
    titre: texte(form.titre, 400),
    description: texte(form.description, 4000),
    styles: Array.isArray(form.styles) ? form.styles.slice(0, 10).map((style) => texte(style, 80)) : [],
    nom: texte(form.nom, 400),
    bio: texte(form.bio, 4000),
    ville: texte(form.ville, 200),
    instagram: texte(form.instagram, 300),
    email: texte(form.email, 300),
    lien: texte(form.lien, 1000),
    tracklist: texte(form.tracklist, 40_000),
    message: texte(form.message, 4000),
  };
}

const PAS_LU = reponse({ ok: false, errors: { form: "La candidature n'a pas pu être lue : réessaie." } }, 400);
const PANNE = reponse({ ok: false, errors: { form: "La candidature n'a pas pu partir : la base ne répond pas. Tes réponses sont gardées, réessaie dans un moment." } }, 503);

/** La photo, en formulaire : déposer l'original, puis l'inscrire recadrée ; ou la retirer. */
async function photo(context: APIContext): Promise<Response> {
  const data = await context.request.formData().catch(() => null);
  if (!data) return PAS_LU;
  const champ = (nom: string) => String(data.get(nom) ?? "");
  const candidatures = await candidaturesDuSite();
  const jeton = champ("jeton");
  if (!(await candidatures.dossierOuvert(jeton))) return reponse({ ok: false, errors: { photo: "Ton envoi a expiré : recharge la page pour recommencer." } }, 404);
  if (!storageReady()) return reponse({ ok: false, errors: { photo: "L'envoi des photos n'est pas encore branché : envoie ta candidature sans, on te la demandera." } }, 503);
  switch (champ("etape")) {
    case "upload": {
      const ticket = await uploadTicket(champ("type"), Number(champ("size")));
      return "error" in ticket ? reponse({ ok: false, errors: { photo: ticket.error } }, 422) : reponse({ ok: true, ...ticket });
    }
    case "finalize": {
      const prepared = await prepare(champ("path"), "square", Number.parseFloat(champ("focus")));
      if ("error" in prepared) return reponse({ ok: false, errors: { photo: prepared.error } }, 422);
      const added = await candidatures.ajouterPhoto(jeton, prepared.file);
      if (!added.ok) {
        await removeImages(prepared.keys);
        return reponse({ ok: false, errors: added.errors }, 422);
      }
      await removeImages(added.removedImages);
      return reponse({ ok: true, image: mediaView(added.media) });
    }
    case "retirer": {
      await removeImages(await candidatures.retirerPhoto(jeton));
      return reponse({ ok: true });
    }
  }
  return reponse({ ok: false, errors: { form: "Action inconnue." } }, 404);
}

async function traiter(context: APIContext): Promise<Response> {
  if (context.params.action === "photo") return photo(context);
  const corps = await corpsDe(context);
  if (!corps) return PAS_LU;
  const candidatures = await candidaturesDuSite();
  const jeton = texte(corps.jeton, 64);

  switch (context.params.action) {
    case "dossier": {
      // Le champ piège : un robot le remplit, et croit que c'est passé.
      if (texte(corps.site, 300).trim()) return reponse({ ok: true, jeton: randomBytes(32).toString("base64url") });
      // Ouvrir un dossier passe par Turnstile ; un dossier déjà ouvert se met à jour sans.
      if (!(await candidatures.dossierOuvert(jeton))) {
        const humain = verificationHumaine(corps.turnstile, ipDe(context), context.url.hostname, ACTION_CANDIDATURE);
        if (humain && !(await humain()))
          return reponse({ ok: false, verification: true, errors: { form: "La vérification anti-robots n'est pas passée. Tes réponses sont gardées : réessaie." } }, 403);
      }
      const dossier = await candidatures.ouvrirDossier(lireForm(corps.form), jeton);
      if (!dossier.ok) return reponse({ ok: false, errors: dossier.errors }, dossier.status);
      return reponse({ ok: true, jeton: dossier.jeton });
    }

    case "son": {
      if (!r2Ready()) return reponse({ ok: false, errors: { son: "L'envoi des fichiers n'est pas encore branché : réessaie plus tard." } }, 503);
      const prepare = await candidatures.preparerSon(jeton, { fileName: texte(corps.fileName, 300), size: Number(corps.size) });
      if (!prepare.ok) return reponse({ ok: false, errors: prepare.errors }, prepare.status);
      // le son qu'il remplace (un autre fichier choisi entre-temps) quitte le seau
      await removeFiles(prepare.removedKeys);
      return reponse({ ok: true, id: prepare.id, mime: prepare.mime, url: await uploadUrl(prepare.key, prepare.mime) });
    }

    case "deposer": {
      const sonId = texte(corps.son, 64);
      let son: { id: string; size: number } | null = null;
      if (sonId) {
        const key = await candidatures.cleSon(jeton, sonId);
        const size = key ? await headSize(key) : null;
        if (!size) return reponse({ ok: false, errors: { son: "Ton fichier n'est pas arrivé en entier : envoie-le de nouveau." } }, 422);
        son = { id: sonId, size };
      }
      const depot = await candidatures.deposer(jeton, lireForm(corps.form), son);
      if (!depot.ok) return reponse({ ok: false, errors: depot.errors }, depot.status);
      await removeFiles(depot.removedKeys);
      console.log(`Candidatures : une candidature reçue (${texte((corps.form as Record<string, unknown> | undefined)?.type, 20)}${son ? ", avec son son" : ", par son lien"}).`);
      return reponse({ ok: true });
    }
  }
  return reponse({ ok: false, errors: { form: "Action inconnue." } }, 404);
}

export const POST: APIRoute = async (context) => {
  if (!memeOrigine(context)) return reponse({ ok: false, errors: { form: "Cette candidature ne vient pas du site de Parabole." } }, 403);
  try {
    return await traiter(context);
  } catch (panne) {
    console.error(`candidature (${context.params.action}) : échec`, panne);
    return PANNE;
  }
};
