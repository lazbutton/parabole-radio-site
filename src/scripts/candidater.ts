// ---------- CANDIDATER : L'ÉMISSION, L'ARTISTE, LE SON, PUIS « C'EST REÇU » ----------
// La page /candidater (src/pages/candidater.astro, cms/README.md, 9.17) écrit tout ; ce script en fait un formulaire en
// trois écrans. Il montre un écran à la fois et le vérifie avant de passer au suivant, avec les règles et les messages
// du serveur (@parabole/cms/candidatures) : le message sous le champ, le curseur dessus, et le message s'efface dès que
// c'est corrigé. Les aides suivent le type choisi. Changer d'écran, c'est zapper : l'écran clignote comme à l'allumage
// (tele.css), sauf avec « réduire les animations ».
//
// L'envoi passe par un dossier (/api/candidature/…) : à la fin de l'écran 2, le script l'ouvre, avec la vérification
// Turnstile là où le site a ses clés (le plus souvent, elle ne demande rien ; sinon sa case s'ouvre au-dessus des
// touches), et reçoit son jeton. La photo part alors au Storage (choisie plus tôt, elle attendait le dossier), et le MP3,
// dès qu'il est choisi, part tout droit dans le seau R2 à l'adresse que signe le serveur, avec sa progression. ENVOYER
// attend la fin du MP3, puis dépose la candidature. Le brouillon reste dans le navigateur (localStorage), le jeton, le
// MP3 arrivé et la photo compris : on peut quitter la page, ou l'appli d'Insta, et reprendre. Quitter la page pendant
// qu'un fichier part demande confirmation. Un refus du serveur ramène à l'écran du champ en cause ; le brouillon n'est
// effacé qu'une fois la candidature reçue. Branché sur astro:page-load : à chaque arrivée sur la page.
import { CHAMPS_PAR_ECRAN, compteInsta, lienPossible, lireCandidature, lireDossier, type CandidatureErrors, type CandidatureForm } from "@parabole/cms/candidatures";
import { audioRefusal, WANTED_KBPS } from "@parabole/cms/envois";
import { PUBLIC_TURNSTILE_SITE_KEY } from "astro:env/client";
import { mp3Kbps, putAudio } from "../components/envoi/audio";

type ParType = { description: string; son: string; tracklist: string };
type Config = { stylesMax: number; types: Record<string, ParType>; image: { max: number; types: string[]; cote: number } };
type Champ = HTMLInputElement | HTMLTextAreaElement;
type Faute = { champ: string; message: string; cibles: Champ[] };
type Reponse = {
  ok?: boolean;
  errors?: Record<string, string>;
  verification?: boolean;
  jeton?: string;
  id?: string;
  url?: string;
  mime?: string;
  path?: string;
  image?: { url: string; thumb: string };
};
type Appel = { statut: number; corps: Reponse };

/** Le MP3 choisi : en route vers le seau, arrivé, ou refusé (le message dit pourquoi). */
type Son = { id: string | null; nom: string; taille: number; etat: "envoi" | "recu" | "erreur"; pourcent: number; erreur?: string; kbps?: number | null };
/**
 * La photo choisie : en attente du dossier, en route, inscrite, ou refusée. L'aperçu est le fichier lui-même (ou, d'un
 * brouillon, la vignette du site) ; `serveur`, sa vignette sur le site une fois inscrite.
 */
type Photo = { etat: "attente" | "envoi" | "prete" | "erreur"; apercu: string; fichier: File | null; serveur?: string; erreur?: string };
type Brouillon = {
  ici?: number;
  atteinte?: number;
  champs?: Record<string, string>;
  styles?: string[];
  dossier?: { jeton: string; depuis: number };
  son?: { id: string; nom: string; taille: number; kbps?: number | null };
  photo?: { apercu: string };
};

/** Le brouillon, dans le navigateur. */
const CLE = "parabole:candidature";
const ETAPES = 3;
/** Les champs gardés dans le brouillon et envoyés (les styles et les fichiers à part). */
const CHAMPS = ["type", "frequence", "titre", "description", "nom", "bio", "ville", "instagram", "email", "lien", "tracklist", "message"] as const;
/** Le serveur oublie un dossier jamais envoyé au bout d'un jour : le brouillon, un peu avant. */
const DOSSIER_GARDE_MS = 23 * 3600 * 1000;
const JETON = /^[A-Za-z0-9_-]{43}$/;
const PANNE_RESEAU = "La connexion a coupé. Tes réponses sont gardées : réessaie dans un moment.";

const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const poids = (octets: number) =>
  octets >= 1e9 ? `${(octets / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go` : `${Math.max(1, Math.round(octets / 1e6))} Mo`;

// ---------- la vérification anti-robots (Turnstile), chargée à l'ouverture du dossier ----------
type Turnstile = { render(el: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
let turnstile: Promise<Turnstile | null> | null = null;
function chargerTurnstile(): Promise<Turnstile | null> {
  turnstile ??= new Promise((fin) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => fin((window as unknown as { turnstile?: Turnstile }).turnstile ?? null);
    script.onerror = () => fin(null);
    document.head.append(script);
  });
  return turnstile;
}
/** Le jeton de la vérification, rendu dans `caseTurnstile` ; null si elle n'a pas pu se faire. */
async function preuveHumaine(caseTurnstile: HTMLElement): Promise<string | null> {
  const api = await chargerTurnstile();
  if (!api) return null;
  caseTurnstile.hidden = false;
  return new Promise((fin) => {
    let id = "";
    const finir = (jeton: string | null) => {
      if (id) api.remove(id);
      caseTurnstile.hidden = true;
      fin(jeton);
    };
    id = api.render(caseTurnstile, {
      sitekey: PUBLIC_TURNSTILE_SITE_KEY,
      action: "candidature", // vérifiée par le serveur (src/lib/candidatures.ts)
      appearance: "interaction-only",
      theme: "dark",
      language: "fr",
      callback: (jeton: string) => finir(jeton),
      "error-callback": () => finir(null),
      "timeout-callback": () => finir(null),
    });
  });
}

// ---------- les appels au serveur ----------
/** Un appel à /api/candidature/<action>, en JSON ou en formulaire. Une panne devient un message, jamais une page perdue. */
async function appeler(action: string, corps: Record<string, unknown> | FormData, signal: AbortSignal): Promise<Appel> {
  try {
    const reponse = await fetch(
      `/api/candidature/${action}`,
      corps instanceof FormData
        ? { method: "POST", body: corps, signal }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps), signal },
    );
    const lu = (await reponse.json().catch(() => null)) as Reponse | null;
    return { statut: reponse.status, corps: lu ?? { ok: false, errors: { form: "Le site n'a pas répondu comme prévu. Réessaie dans un instant." } } };
  } catch (erreur) {
    if (signal.aborted) throw erreur;
    return { statut: 0, corps: { ok: false, errors: { form: PANNE_RESEAU } } };
  }
}
const formulaireDe = (champs: Record<string, string>) => {
  const data = new FormData();
  for (const [nom, valeur] of Object.entries(champs)) data.set(nom, valeur);
  return data;
};
/** Le corps du dépôt d'une image à l'adresse signée du Storage (comme uploadToSignedUrl du client Supabase). */
const corpsImage = (fichier: File) => {
  const data = new FormData();
  data.append("cacheControl", "3600");
  data.append("", fichier);
  return data;
};
/** La taille d'une image, lue par le navigateur ; null s'il ne sait pas l'afficher (le serveur saura peut-être). */
function tailleImage(adresse: string): Promise<{ largeur: number; hauteur: number } | null> {
  return new Promise((fin) => {
    const image = new Image();
    const minuterie = window.setTimeout(() => fin(null), 5000);
    image.onload = () => {
      window.clearTimeout(minuterie);
      fin({ largeur: image.naturalWidth, hauteur: image.naturalHeight });
    };
    image.onerror = () => {
      window.clearTimeout(minuterie);
      fin(null);
    };
    image.src = adresse;
  });
}

let quitter: (() => void) | null = null;

document.addEventListener("astro:page-load", () => {
  quitter?.();
  quitter = null;
  const page = document.querySelector<HTMLElement>("[data-candidater]");
  if (page) quitter = brancher(page);
});
document.addEventListener("astro:before-swap", () => {
  quitter?.();
  quitter = null;
});

function brancher(page: HTMLElement): () => void {
  const config = JSON.parse(page.dataset.config ?? "{}") as Config;
  const form = page.querySelector<HTMLFormElement>("[data-form]")!;
  // Tout est complet : la page le dit, il n'y a rien à remplir.
  if (form.hidden) return () => {};
  const un = <T extends Element = HTMLElement>(selecteur: string) => page.querySelector<T>(selecteur)!;
  const panneau = un(".cand-panneau");
  const etapes = [...page.querySelectorAll<HTMLElement>("[data-etape]")];
  const pas = [...page.querySelectorAll<HTMLElement>("[data-pas]")];
  const annonce = un("[data-annonce]");
  const retour = un<HTMLButtonElement>("[data-retour]");
  const suivant = un<HTMLButtonElement>("[data-suivant]");
  const envoyer = un<HTMLButtonElement>("[data-envoyer]");
  const texteEnvoyer = un("[data-envoyer-texte]");
  const texteEnvoyerDebut = texteEnvoyer.innerHTML;
  const erreurEnvoi = un('[data-erreur="envoi"]');
  const noteBrouillon = un("[data-brouillon]");
  const caseVerification = un("[data-verification]");
  const recu = un("[data-recu]");
  const comptePuces = page.querySelector<HTMLElement>("[data-styles-compte]");
  const champ = <T extends Champ = HTMLInputElement>(nom: string) => form.querySelector<T>(`[name="${nom}"]`)!;
  // la photo
  const choixPhoto = champ("photo");
  const cadrePhoto = un("[data-photo-cadre]");
  const imagePhoto = un<HTMLImageElement>("[data-photo-image]");
  const videPhoto = un("[data-photo-vide]");
  const etatPhoto = un("[data-photo-etat]");
  const actionsPhoto = un("[data-photo-actions]");
  // le MP3
  const choixSon = champ("son");
  const depot = un("[data-depot]");
  const fiche = un("[data-fichier]");
  const barre = un("[data-barre]");
  const plein = un("[data-barre-plein]");
  const etatSon = un("[data-fichier-etat]");
  const noteSon = un("[data-fichier-note]");
  const zoneLien = un("[data-lien]");
  /** Le type des aides tant qu'aucun n'est choisi : le premier ouvert. */
  const typeParDefaut = form.querySelector<HTMLInputElement>('[name="type"]:not(:disabled)')?.value ?? "dj_set";

  const controle = new AbortController();
  const { signal } = controle;
  let ici = 1;
  let atteinte = 1;
  let minuterie = 0;
  /** Les écrans où l'on a déjà essayé de passer : leurs messages se tiennent à jour pendant qu'on corrige. */
  const tentes = new Set<number>();
  /** Le dossier de l'envoi : son jeton, et depuis quand il est ouvert. */
  let jeton: string | null = null;
  let depuis = 0;
  let ouverture: Promise<boolean> | null = null;
  let son: Son | null = null;
  let sonControle: AbortController | null = null;
  let sonEnvoi: Promise<void> = Promise.resolve();
  let photo: Photo | null = null;
  /** Les gestes sur la photo partent l'un après l'autre : sur le serveur, le dernier fait foi. */
  let filePhoto: Promise<unknown> = Promise.resolve();
  /** Une ouverture de dossier ou un envoi en cours : les touches attendent. */
  let occupe = false;
  /** ENVOYER attend la fin du MP3 : la touche en montre la progression. */
  let attendSon = false;

  // ---------- les valeurs ----------
  const valeur = (nom: string): string => {
    const element = form.elements.namedItem(nom) as HTMLInputElement | RadioNodeList | null;
    return (element?.value ?? "").trim();
  };
  const type = () => valeur("type");
  const puces = (): HTMLInputElement[] => [...page.querySelectorAll<HTMLInputElement>(`[data-styles="${type() || typeParDefaut}"] input`)];
  const styles = () => puces().filter((puce) => puce.checked).map((puce) => puce.value);
  const formulaire = (): CandidatureForm => ({ ...(Object.fromEntries(CHAMPS.map((nom) => [nom, valeur(nom)])) as Omit<CandidatureForm, "styles">), styles: styles() });
  /** Un MP3 est choisi et n'a pas été refusé : arrivé, ou en route (ENVOYER l'attendra). */
  const aUnSon = () => !!son && son.etat !== "erreur";
  const enRoute = () => son?.etat === "envoi" || photo?.etat === "envoi";

  // ---------- les écrans ----------
  function aller(n: number, { focus = true, zap = true } = {}) {
    ici = Math.min(Math.max(n, 1), ETAPES);
    atteinte = Math.max(atteinte, ici);
    for (const etape of etapes) etape.toggleAttribute("data-ici", Number(etape.dataset.etape) === ici);
    for (const li of pas) {
      const k = Number(li.dataset.pas);
      li.dataset.etat = k < ici ? "fait" : k === ici ? "ici" : "apres";
      const bouton = li.querySelector("button")!;
      bouton.disabled = k > atteinte || k === ici;
      if (k === ici) bouton.setAttribute("aria-current", "step");
      else bouton.removeAttribute("aria-current");
    }
    retour.hidden = ici === 1;
    suivant.hidden = ici === ETAPES;
    envoyer.hidden = ici !== ETAPES;
    const courant = etapes[ici - 1]!;
    if (zap && !calme()) {
      courant.classList.remove("cand-zap");
      void courant.offsetWidth; // relance l'animation
      courant.classList.add("cand-zap");
    }
    annonce.textContent = `Étape ${ici} sur ${ETAPES} : ${courant.querySelector("h2")?.textContent?.replace(/^\d\/\d\s*/, "") ?? ""}`;
    if (focus) {
      courant.querySelector<HTMLElement>(".cand-etape-titre")?.focus({ preventScroll: true });
      if (panneau.getBoundingClientRect().top < 0) panneau.scrollIntoView({ block: "start", behavior: calme() ? "auto" : "smooth" });
    }
    sauver();
  }

  // ---------- les vérifications : les règles du serveur, écran par écran ----------
  /** Les champs où poser une erreur (et le curseur). */
  function ciblesDe(nom: string): Champ[] {
    if (nom === "contact") return [champ("instagram"), champ("email")];
    const premier = form.querySelector<Champ>(`[name="${nom}"]:not(:disabled)`) ?? form.querySelector<Champ>(`[name="${nom}"]`);
    return premier ? [premier] : [];
  }
  /** Les fautes d'un écran, dans l'ordre de ses champs. */
  function fautesDe(etape: number, erreurs: CandidatureErrors): Faute[] {
    return CHAMPS_PAR_ECRAN[etape as 1 | 2 | 3].filter((nom) => erreurs[nom]).map((nom) => ({ champ: nom, message: erreurs[nom]!, cibles: ciblesDe(nom) }));
  }
  /** Les fichiers refusés : la photo, le MP3. */
  function erreursFichiers(): CandidatureErrors {
    const erreurs: CandidatureErrors = {};
    if (photo?.etat === "erreur") erreurs.photo = photo.erreur ?? "Cette photo n'est pas passée : choisis-en une autre, ou retire-la.";
    if (son?.etat === "erreur") erreurs.son = son.erreur ?? "Ton MP3 n'est pas passé : choisis-le de nouveau.";
    return erreurs;
  }
  const erreurs = (): CandidatureErrors => ({ ...lireCandidature(formulaire(), { aSon: aUnSon() }).errors, ...erreursFichiers() });
  const verifier = (etape: number) => fautesDe(etape, erreurs());

  /** Affiche les fautes d'un écran (et efface celles qui sont corrigées) ; avec `viser`, le curseur va sur la première. */
  function montrer(etape: number, fautes: Faute[], viser: boolean) {
    const zone = etapes[etape - 1]!;
    zone.querySelectorAll<HTMLElement>("[data-erreur]").forEach((p) => {
      p.hidden = true;
      p.textContent = "";
    });
    zone.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    zone.querySelectorAll("[data-faux]").forEach((el) => el.removeAttribute("data-faux"));
    for (const faute of fautes) {
      const message = zone.querySelector<HTMLElement>(`[data-erreur="${faute.champ}"]`);
      if (message) {
        message.textContent = faute.message;
        message.hidden = false;
      }
      zone.querySelector(`[data-champ="${faute.champ}"]`)?.setAttribute("data-faux", "");
      for (const cible of faute.cibles) if (cible.type !== "radio") cible.setAttribute("aria-invalid", "true");
    }
    if (viser && fautes[0]) {
      fautes[0].cibles[0]?.focus();
      annonce.textContent = fautes.length > 1 ? `${fautes.length} choses à revoir. ${fautes[0].message}` : fautes[0].message;
    }
  }
  /** Un fichier a changé d'état : son écran se met à jour, sans y mettre le curseur (pas encore essayé : ses fichiers seuls). */
  function rafraichir(etape: number) {
    montrer(etape, tentes.has(etape) ? verifier(etape) : fautesDe(etape, erreursFichiers()), false);
  }

  /** Ramène à l'écran du premier champ en faute ; rend faux s'il n'y en a pas. */
  function revenirAuxFautes(fautes: CandidatureErrors): boolean {
    for (let k = 1; k <= ETAPES; k++) {
      const ecran = fautesDe(k, fautes);
      if (!ecran.length) continue;
      tentes.add(k);
      if (k !== ici) aller(k, { focus: false });
      montrer(k, fautesDe(k, { ...erreurs(), ...fautes }), true);
      return true;
    }
    return false;
  }

  function direErreur(message: string) {
    erreurEnvoi.textContent = message;
    erreurEnvoi.hidden = false;
    annonce.textContent = message;
  }
  /** Un refus du serveur : chaque champ à son écran, le reste sous les touches. */
  function refuser(erreursServeur: Record<string, string> = {}) {
    const { form: general, ...parChamp } = erreursServeur;
    const ramene = revenirAuxFautes(parChamp);
    if (general) direErreur(general);
    else if (!ramene) direErreur("Ça n'a pas marché. Tes réponses sont gardées : réessaie dans un moment.");
  }
  function attendre(bouton: HTMLButtonElement, oui: boolean) {
    bouton.disabled = oui;
    if (oui) bouton.setAttribute("aria-busy", "true");
    else bouton.removeAttribute("aria-busy");
  }

  async function passer() {
    if (occupe) return;
    tentes.add(ici);
    const fautes = verifier(ici);
    montrer(ici, fautes, true);
    if (fautes.length) return;
    if (ici === 2) {
      // l'écran 1 a pu changer depuis (on y revient d'un clic) : le dossier s'ouvre sur deux écrans justes
      if (revenirAuxFautes(lireDossier(formulaire()).errors)) return;
      occupe = true;
      attendre(suivant, true);
      erreurEnvoi.hidden = true;
      const ouvert = await ouvrir()
        .catch(() => false)
        .finally(() => {
          occupe = false;
          attendre(suivant, false);
        });
      if (!ouvert || signal.aborted) return;
    }
    aller(ici + 1);
  }

  // ---------- le dossier de l'envoi ----------
  /**
   * Ouvre le dossier (les écrans 1 et 2, revérifiés par le serveur), ou le met à jour s'il l'est déjà ; une seule
   * ouverture à la fois. La vérification anti-robots ne sert qu'à l'ouvrir. Rend vrai s'il est ouvert ; sinon, le refus
   * est affiché.
   */
  function ouvrir(): Promise<boolean> {
    ouverture ??= ouvrirMaintenant().finally(() => (ouverture = null));
    return ouverture;
  }
  async function ouvrirMaintenant(): Promise<boolean> {
    let verification: string | null = null;
    if (!jeton && PUBLIC_TURNSTILE_SITE_KEY) {
      verification = await preuveHumaine(caseVerification);
      if (signal.aborted) return false;
      if (!verification) {
        direErreur("La vérification anti-robots n'a pas pu se faire. Tes réponses sont gardées : réessaie.");
        return false;
      }
    }
    const { statut, corps } = await appeler("dossier", { jeton: jeton ?? "", form: formulaire(), site: champ("site").value, turnstile: verification }, signal);
    if (corps.ok && corps.jeton) {
      if (corps.jeton !== jeton) {
        jeton = corps.jeton;
        depuis = Date.now();
      }
      sauver();
      envoyerPhoto(); // une photo choisie plus tôt attendait le dossier
      return true;
    }
    // le dossier a expiré entre-temps : le serveur en ouvrirait un autre, avec la vérification
    if (statut === 403 && corps.verification && jeton) {
      perdu();
      return ouvrirMaintenant();
    }
    refuser(corps.errors);
    return false;
  }

  /**
   * Le dossier n'existe plus sur le serveur (plus d'un jour) : on l'oublie, avec ce qui y était déposé. Le MP3 est à
   * rechoisir, on le dit ; avec `dire`, on dit aussi qu'il faut renvoyer.
   */
  function perdu(dire = false) {
    jeton = null;
    if (son) {
      sonControle?.abort();
      son = null;
      afficherSon();
      direErreur("Ton envoi a expiré : choisis de nouveau ton MP3. Tes réponses sont gardées.");
    } else if (dire) direErreur("Ton envoi a expiré : envoie-le de nouveau. Tes réponses sont gardées.");
    if (photo) {
      // choisie sur cette page, elle repart avec le prochain dossier ; venue d'un brouillon, il faut la rechoisir
      if (photo.fichier && photo.etat !== "erreur") photo.etat = "attente";
      else if (!photo.fichier) photo = null;
      afficherPhoto();
    }
    sauver();
  }

  // ---------- la photo ----------
  function afficherPhoto() {
    const choisie = photo;
    const apercu = choisie?.apercu ?? "";
    imagePhoto.hidden = !apercu;
    if (apercu && imagePhoto.getAttribute("src") !== apercu) imagePhoto.src = apercu;
    if (!apercu) imagePhoto.removeAttribute("src");
    videPhoto.hidden = !!apercu;
    actionsPhoto.hidden = !choisie;
    cadrePhoto.dataset.etat = choisie?.etat ?? "vide";
    etatPhoto.hidden = !choisie || choisie.etat === "attente";
    etatPhoto.textContent = choisie?.etat === "envoi" ? "Envoi" : choisie?.etat === "prete" ? "✓" : choisie?.etat === "erreur" ? "!" : "";
  }
  function oublierApercu(choisie: Photo | null) {
    if (choisie?.apercu.startsWith("blob:")) URL.revokeObjectURL(choisie.apercu);
  }

  async function choisirPhoto(fichier: File) {
    const refus = !config.image.types.includes(fichier.type)
      ? "Une photo en JPEG, PNG, WebP ou AVIF seulement."
      : fichier.size > config.image.max
        ? `Cette photo dépasse ${config.image.max / 1_000_000} Mo : réduis-la avant de l'envoyer.`
        : null;
    oublierApercu(photo);
    const courant: Photo = refus ? { etat: "erreur", apercu: "", fichier: null, erreur: refus } : { etat: "attente", apercu: URL.createObjectURL(fichier), fichier };
    photo = courant;
    afficherPhoto();
    rafraichir(2);
    if (refus) return;
    const taille = await tailleImage(courant.apercu);
    if (photo !== courant) return;
    if (taille && Math.min(taille.largeur, taille.hauteur) < config.image.cote) {
      courant.etat = "erreur";
      courant.erreur = `Cette photo est trop petite : ${config.image.cote} pixels de côté au moins.`;
      afficherPhoto();
      rafraichir(2);
      return;
    }
    if (jeton) envoyerPhoto();
  }

  /** Envoie la photo en attente, une fois le dossier ouvert : l'original au Storage, puis le serveur la recadre et l'inscrit. */
  function envoyerPhoto() {
    const courant = photo;
    if (!courant || courant.etat !== "attente" || !courant.fichier || !jeton) return;
    courant.etat = "envoi";
    afficherPhoto();
    filePhoto = filePhoto.then(() => televerserPhoto(courant)).catch(() => undefined);
  }
  async function televerserPhoto(courant: Photo) {
    const fichier = courant.fichier;
    if (photo !== courant || !fichier || !jeton) {
      if (photo === courant) {
        courant.etat = "attente";
        afficherPhoto();
      }
      return;
    }
    try {
      const billet = await appeler("photo", formulaireDe({ jeton, etape: "upload", type: fichier.type, size: String(fichier.size) }), signal);
      if (!billet.corps.ok || !billet.corps.url || !billet.corps.path) return photoRefusee(courant, billet);
      const depose = await fetch(billet.corps.url, { method: "PUT", headers: { "x-upsert": "false" }, body: corpsImage(fichier), signal }).catch((erreur) => {
        if (signal.aborted) throw erreur;
        return null;
      });
      if (!depose?.ok) return photoRefusee(courant, { statut: 0, corps: { errors: { photo: "La photo n'est pas partie : vérifie la connexion, puis choisis-la de nouveau." } } });
      const faite = await appeler("photo", formulaireDe({ jeton, etape: "finalize", path: billet.corps.path, focus: "0.5" }), signal);
      if (!faite.corps.ok) return photoRefusee(courant, faite);
      if (photo !== courant) {
        // retirée pendant l'envoi : on la retire aussi du dossier (remplacée, la suivante la remplace d'elle-même)
        if (!photo && jeton) await appeler("photo", formulaireDe({ jeton, etape: "retirer" }), signal);
        return;
      }
      courant.etat = "prete";
      courant.serveur = faite.corps.image?.thumb;
      afficherPhoto();
      rafraichir(2);
      sauver();
    } catch {
      if (signal.aborted) return;
      photoRefusee(courant, { statut: 0, corps: { errors: { photo: "La photo n'est pas partie : choisis-la de nouveau." } } });
    }
  }
  function photoRefusee(courant: Photo, { statut, corps }: Appel) {
    if (statut === 404) return perdu();
    if (photo !== courant) return;
    courant.etat = "erreur";
    courant.erreur = corps.errors?.photo ?? corps.errors?.form ?? "La photo n'est pas passée : choisis-en une autre, ou retire-la.";
    afficherPhoto();
    rafraichir(2);
  }

  function retirerPhoto() {
    const avant = photo;
    oublierApercu(avant);
    photo = null;
    afficherPhoto();
    rafraichir(2);
    sauver();
    // inscrite (ou en route : son envoi la retirera en finissant), elle quitte aussi le dossier
    if (avant?.etat === "prete")
      filePhoto = filePhoto.then(() => (jeton && !photo ? appeler("photo", formulaireDe({ jeton, etape: "retirer" }), signal) : undefined)).catch(() => undefined);
  }

  // ---------- le MP3 ----------
  function afficherSon() {
    const choisi = son;
    const montre = !!choisi && choisi.etat !== "erreur";
    depot.hidden = montre;
    fiche.hidden = !montre;
    if (choisi && montre) {
      un("[data-fichier-nom]").textContent = choisi.nom;
      un("[data-fichier-poids]").textContent = poids(choisi.taille);
      const faible = !!choisi.kbps && choisi.kbps < WANTED_KBPS;
      noteSon.hidden = !faible;
      noteSon.textContent = faible ? `Ton MP3 est en ${choisi.kbps} kbit/s : pour l'antenne, ${WANTED_KBPS} kbit/s, c'est mieux. Tu peux l'envoyer tel quel.` : "";
      afficherProgression();
    }
    suivreLien();
  }
  function afficherProgression() {
    const choisi = son;
    if (!choisi) return;
    const pourcent = choisi.etat === "recu" ? 100 : choisi.pourcent;
    plein.style.transform = `scaleX(${pourcent / 100})`;
    barre.setAttribute("aria-valuenow", String(pourcent));
    fiche.dataset.etat = choisi.etat;
    etatSon.textContent = choisi.etat === "recu" ? "✓ Reçu" : `Envoi… ${pourcent} %`;
    if (attendSon) texteEnvoyer.textContent = `Le MP3 arrive… ${pourcent} %`;
  }

  async function choisirSon(fichier: File) {
    sonControle?.abort();
    const refus = audioRefusal(fichier.name, fichier.size, "main");
    if (refus) {
      son = { id: null, nom: fichier.name, taille: fichier.size, etat: "erreur", pourcent: 0, erreur: refus };
      afficherSon();
      rafraichir(3);
      return;
    }
    const courant: Son = { id: null, nom: fichier.name, taille: fichier.size, etat: "envoi", pourcent: 0, kbps: null };
    son = courant;
    afficherSon();
    rafraichir(3);
    annonce.textContent = "Ton MP3 part.";
    void mp3Kbps(fichier).then(
      (kbps) => {
        if (son !== courant) return;
        courant.kbps = kbps;
        afficherSon();
      },
      () => undefined,
    );
    const ce = new AbortController();
    sonControle = ce;
    const fin = (async () => {
      try {
        if (!jeton && !(await ouvrir())) {
          if (son === courant) {
            son = null;
            afficherSon();
          }
          return;
        }
        const pret = await appeler("son", { jeton, fileName: fichier.name, size: fichier.size }, ce.signal);
        if (son !== courant) return;
        if (!pret.corps.ok || !pret.corps.id || !pret.corps.url || !pret.corps.mime) {
          if (pret.statut === 404) return perdu();
          return sonRefuse(courant, pret.corps.errors?.son ?? pret.corps.errors?.form ?? "Ton MP3 n'a pas pu partir : réessaie.");
        }
        courant.id = pret.corps.id;
        await putAudio(
          pret.corps.url,
          fichier,
          pret.corps.mime,
          (pourcent) => {
            if (son !== courant) return;
            courant.pourcent = Math.min(99, pourcent);
            afficherProgression();
          },
          ce.signal,
        );
        if (son !== courant) return;
        courant.etat = "recu";
        courant.pourcent = 100;
        afficherSon();
        rafraichir(3);
        sauver();
        annonce.textContent = "Ton MP3 est bien arrivé.";
      } catch (erreur) {
        if ((erreur as Error | null)?.name === "AbortError" || son !== courant) return;
        sonRefuse(courant, erreur instanceof Error ? erreur.message : "La connexion a coupé pendant l'envoi : choisis ton MP3 de nouveau.");
      } finally {
        if (sonControle === ce) sonControle = null;
      }
    })();
    sonEnvoi = fin;
    await fin;
  }
  function sonRefuse(courant: Son, message: string) {
    courant.etat = "erreur";
    courant.erreur = message;
    afficherSon();
    rafraichir(3);
  }
  function retirerSon() {
    sonControle?.abort();
    son = null;
    afficherSon();
    rafraichir(3);
    sauver();
  }

  // ---------- les aides suivent le type ----------
  function suivreType() {
    const choisi = type() || typeParDefaut;
    const textes = config.types[choisi];
    if (textes) {
      champ<HTMLTextAreaElement>("description").placeholder = textes.description;
      un("[data-aide-son]").textContent = textes.son;
      un("[data-aide-tracklist]").textContent = textes.tracklist;
    }
    page.querySelectorAll<HTMLElement>("[data-styles]").forEach((groupe) => {
      groupe.hidden = groupe.dataset.styles !== choisi;
      // les styles d'un autre type ne partent pas
      if (groupe.hidden) groupe.querySelectorAll<HTMLInputElement>("input").forEach((puce) => (puce.checked = false));
    });
    limiterStyles();
    suivreLien();
  }
  /** Le lien d'une playlist, à la place du MP3 : pour une playlist, tant qu'aucun MP3 n'est choisi. */
  function suivreLien() {
    zoneLien.hidden = !lienPossible(type() || typeParDefaut) || aUnSon();
  }

  function limiterStyles() {
    const choisis = styles().length;
    for (const puce of puces()) puce.disabled = !puce.checked && choisis >= config.stylesMax;
    if (comptePuces) comptePuces.textContent = choisis ? `${choisis} sur ${config.stylesMax}` : "";
  }

  function compter(zone: Champ) {
    const compteur = page.querySelector<HTMLElement>(`[data-compteur="${zone.name}"]`);
    if (!compteur) return;
    const n = zone.value.length;
    compteur.textContent = `${n} / ${zone.maxLength}`;
    compteur.toggleAttribute("data-plein", n > zone.maxLength * 0.9);
  }

  // ---------- le brouillon ----------
  function sauver() {
    window.clearTimeout(minuterie);
    minuterie = window.setTimeout(() => {
      const champs = Object.fromEntries(CHAMPS.map((nom) => [nom, valeur(nom)]));
      const rempli = Object.values(champs).some(Boolean) || !!jeton;
      const brouillon: Brouillon = { ici, atteinte, champs, styles: styles() };
      if (jeton) {
        brouillon.dossier = { jeton, depuis };
        if (son?.etat === "recu" && son.id) brouillon.son = { id: son.id, nom: son.nom, taille: son.taille, kbps: son.kbps ?? null };
        if (photo?.etat === "prete" && photo.serveur) brouillon.photo = { apercu: photo.serveur };
      }
      try {
        if (rempli) localStorage.setItem(CLE, JSON.stringify(brouillon));
        else localStorage.removeItem(CLE);
      } catch {
        return; // navigation privée : pas de brouillon
      }
      noteBrouillon.hidden = !rempli;
    }, 250);
  }

  function restaurer() {
    let brouillon: Brouillon | null = null;
    try {
      brouillon = JSON.parse(localStorage.getItem(CLE) ?? "null") as Brouillon | null;
    } catch {
      brouillon = null;
    }
    if (!brouillon?.champs) return;
    const champs = { ...brouillon.champs };
    // un brouillon d'avant l'envoi direct : son idée devient la description
    if (!champs.description && champs.idee) champs.description = champs.idee;
    for (const nom of CHAMPS) {
      const garde = champs[nom] ?? "";
      const element = form.elements.namedItem(nom);
      if (element instanceof RadioNodeList) {
        // un type devenu complet depuis ne se recoche pas
        for (const option of element) if (option instanceof HTMLInputElement) option.checked = option.value === garde && !option.disabled;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = garde;
    }
    suivreType();
    for (const puce of puces()) puce.checked = brouillon.styles?.includes(puce.value) ?? false;
    const dossier = brouillon.dossier;
    if (dossier && JETON.test(dossier.jeton) && Date.now() - dossier.depuis < DOSSIER_GARDE_MS) {
      jeton = dossier.jeton;
      depuis = dossier.depuis;
      const garde = brouillon.son;
      if (garde?.id) son = { id: garde.id, nom: garde.nom, taille: garde.taille, etat: "recu", pourcent: 100, kbps: garde.kbps ?? null };
      if (brouillon.photo?.apercu) photo = { etat: "prete", apercu: brouillon.photo.apercu, serveur: brouillon.photo.apercu, fichier: null };
    }
    atteinte = Math.min(Math.max(brouillon.atteinte ?? 1, 1), ETAPES);
    ici = Math.min(Math.max(brouillon.ici ?? 1, 1), atteinte);
    noteBrouillon.hidden = false;
  }

  // ---------- l'envoi ----------
  async function envoyerTout() {
    if (occupe) return;
    erreurEnvoi.hidden = true;
    // tout doit être juste, écran par écran : on retourne sinon à celui qui cloche
    if (revenirAuxFautes(erreurs())) return;
    occupe = true;
    attendre(envoyer, true);
    try {
      if (!jeton && !(await ouvrir())) return;
      envoyerPhoto(); // une photo encore en attente
      await filePhoto;
      if (son?.etat === "envoi") {
        attendSon = true;
        afficherProgression();
        await sonEnvoi;
        attendSon = false;
        texteEnvoyer.innerHTML = texteEnvoyerDebut;
      }
      if (signal.aborted || !jeton) return;
      // une photo ou un MP3 refusé entre-temps
      if (revenirAuxFautes(erreurs())) return;
      const { statut, corps } = await appeler("deposer", { jeton, form: formulaire(), son: son?.etat === "recu" ? son.id : "" }, signal);
      if (corps.ok) return fini(valeur("nom"));
      if (statut === 404) return perdu(true);
      // le MP3 n'est pas dans le seau : il faut le renvoyer
      if (corps.errors?.son && son) {
        son.etat = "erreur";
        son.erreur = corps.errors.son;
        afficherSon();
      }
      refuser(corps.errors);
    } catch (erreur) {
      if (signal.aborted) return;
      console.error("candidater : l'envoi n'est pas passé", erreur);
      direErreur(PANNE_RESEAU);
    } finally {
      occupe = false;
      attendSon = false;
      texteEnvoyer.innerHTML = texteEnvoyerDebut;
      attendre(envoyer, false);
    }
  }

  function fini(nom: string) {
    window.clearTimeout(minuterie);
    try {
      localStorage.removeItem(CLE);
    } catch {
      /* rien à effacer */
    }
    jeton = null;
    form.hidden = true;
    recu.hidden = false;
    un("[data-recu-nom]").textContent = nom ? `, ${nom}` : "";
    if (!calme()) recu.classList.add("cand-zap");
    recu.focus({ preventScroll: true });
    if (panneau.getBoundingClientRect().top < 0) panneau.scrollIntoView({ block: "start", behavior: calme() ? "auto" : "smooth" });
  }

  // ---------- les gestes ----------
  form.addEventListener(
    "submit",
    (evenement) => {
      evenement.preventDefault();
      if (ici < ETAPES) void passer();
      else void envoyerTout();
    },
    { signal },
  );
  retour.addEventListener("click", () => aller(ici - 1), { signal });
  for (const li of pas) li.querySelector("button")!.addEventListener("click", () => aller(Number(li.dataset.pas)), { signal });
  form.addEventListener(
    "input",
    (evenement) => {
      const cible = evenement.target as Champ;
      if (cible.name === "site" || cible.type === "file") return;
      if (cible.name === "type") suivreType();
      if (cible.name === "styles") limiterStyles();
      compter(cible);
      if (tentes.has(ici)) montrer(ici, verifier(ici), false);
      sauver();
    },
    { signal },
  );
  // une adresse de profil collée devient le nom du compte, en quittant le champ : on voit ce qu'on a compris
  champ("instagram").addEventListener(
    "change",
    () => {
      const compte = compteInsta(champ("instagram").value);
      if (compte) champ("instagram").value = compte;
      sauver();
    },
    { signal },
  );

  // Les fichiers : un clic sur le cadre (ou la zone), ou un fichier lâché dessus : le champ, étendu sur toute la zone,
  // le reçoit lui-même. Vidé aussitôt lu, il accepte de nouveau le même fichier.
  const lire = (choix: HTMLInputElement, puis: (fichier: File) => unknown) =>
    choix.addEventListener(
      "change",
      () => {
        const fichier = choix.files?.[0];
        choix.value = "";
        if (fichier) void puis(fichier);
      },
      { signal },
    );
  lire(choixPhoto, choisirPhoto);
  lire(choixSon, choisirSon);
  for (const [choix, zone] of [
    [choixPhoto, cadrePhoto],
    [choixSon, depot],
  ] as const) {
    choix.addEventListener("dragenter", () => zone.setAttribute("data-survol", ""), { signal });
    for (const fin of ["dragleave", "drop"]) choix.addEventListener(fin, () => zone.removeAttribute("data-survol"), { signal });
  }
  // un fichier lâché à côté ne remplace pas la page (le texte glissé dans un champ, si)
  for (const geste of ["dragover", "drop"] as const)
    window.addEventListener(
      geste,
      (evenement: DragEvent) => {
        if (!evenement.dataTransfer?.types.includes("Files") || evenement.target === choixPhoto || evenement.target === choixSon) return;
        evenement.preventDefault();
        if (geste === "dragover") evenement.dataTransfer.dropEffect = "none";
      },
      { signal },
    );
  un("[data-photo-changer]").addEventListener("click", () => choixPhoto.click(), { signal });
  un("[data-photo-retirer]").addEventListener("click", retirerPhoto, { signal });
  un("[data-son-changer]").addEventListener("click", () => choixSon.click(), { signal });
  un("[data-son-retirer]").addEventListener("click", retirerSon, { signal });

  // Quitter la page pendant qu'un fichier part : le navigateur demande confirmation. Dans le site, la navigation est
  // rendue au navigateur (Astro recharge alors la page demandée), qui pose la même question.
  window.addEventListener(
    "beforeunload",
    (evenement) => {
      if (!enRoute()) return;
      evenement.preventDefault();
      evenement.returnValue = "";
    },
    { signal },
  );
  document.addEventListener(
    "astro:before-preparation",
    (evenement) => {
      if (enRoute()) evenement.preventDefault();
    },
    { signal },
  );

  restaurer();
  suivreType();
  for (const zone of form.querySelectorAll<HTMLTextAreaElement>("textarea")) compter(zone);
  afficherPhoto();
  afficherSon();
  page.classList.add("pret");
  aller(ici, { focus: false, zap: false });

  return () => {
    window.clearTimeout(minuterie);
    controle.abort();
    sonControle?.abort();
    oublierApercu(photo);
  };
}
