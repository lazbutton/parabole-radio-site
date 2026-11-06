// ---------- CANDIDATER : LES TROIS ÉCRANS DU FORMULAIRE, PUIS « C'EST REÇU » ----------
// La page /candidater (src/pages/candidater.astro, cms/README.md, 9.17) écrit tout ; ce script en fait un formulaire en
// trois écrans. Il montre un écran à la fois et le vérifie avant de passer au suivant, avec les règles et les messages
// du serveur (@parabole/cms/candidatures) : le message sous le champ, le curseur dessus, et le message s'efface dès que
// c'est corrigé. Le dernier écran suit le type choisi (l'idée, le lien d'écoute, les styles). Le brouillon reste dans
// le navigateur (localStorage) : on peut quitter la page, ou l'appli d'Insta, et reprendre. Changer d'écran, c'est
// zapper : l'écran clignote comme à l'allumage (tele.css), sauf avec « réduire les animations ».
//
// L'envoi part vers /api/candidature, avec la vérification Turnstile là où le site a ses clés (en ligne) : le plus
// souvent elle ne demande rien ; sinon sa case s'ouvre au-dessus des touches. Un refus du serveur ramène à l'écran du
// champ en cause ; le brouillon n'est effacé qu'une fois la candidature reçue. Branché sur astro:page-load : à chaque
// arrivée sur la page.
import { CHAMPS_PAR_ECRAN, compteInsta, lienRequis, lireCandidature, type CandidatureErrors, type CandidatureForm } from "@parabole/cms/candidatures";
import { PUBLIC_TURNSTILE_SITE_KEY } from "astro:env/client";

type ParType = { idee: string; lien: string };
type Config = { stylesMax: number; types: Record<string, ParType> };
type Champ = HTMLInputElement | HTMLTextAreaElement;
type Faute = { champ: string; message: string; cibles: Champ[] };
type Reponse = { ok?: boolean; errors?: Record<string, string> };

/** Le brouillon, dans le navigateur. */
const CLE = "parabole:candidature";
const ETAPES = 3;
/** Les champs gardés dans le brouillon et envoyés. */
const CHAMPS = ["type", "prete", "frequence", "nom", "ville", "instagram", "email", "idee", "lien"] as const;

const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- la vérification anti-robots (Turnstile), chargée au premier envoi ----------
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
  const panneau = page.querySelector<HTMLElement>(".cand-panneau")!;
  const etapes = [...page.querySelectorAll<HTMLElement>("[data-etape]")];
  const pas = [...page.querySelectorAll<HTMLElement>("[data-pas]")];
  const annonce = page.querySelector<HTMLElement>("[data-annonce]")!;
  const retour = page.querySelector<HTMLButtonElement>("[data-retour]")!;
  const suivant = page.querySelector<HTMLButtonElement>("[data-suivant]")!;
  const envoyer = page.querySelector<HTMLButtonElement>("[data-envoyer]")!;
  const erreurEnvoi = page.querySelector<HTMLElement>('[data-erreur="envoi"]')!;
  const noteBrouillon = page.querySelector<HTMLElement>("[data-brouillon]")!;
  const caseVerification = page.querySelector<HTMLElement>("[data-verification]")!;
  const recu = page.querySelector<HTMLElement>("[data-recu]")!;
  const idee = form.querySelector<HTMLTextAreaElement>('[name="idee"]')!;
  const compteur = page.querySelector<HTMLElement>("[data-compteur]");
  const comptePuces = page.querySelector<HTMLElement>("[data-styles-compte]");
  const champ = (nom: string) => form.querySelector<HTMLInputElement>(`[name="${nom}"]`)!;

  const controle = new AbortController();
  const { signal } = controle;
  let ici = 1;
  let atteinte = 1;
  let minuterie = 0;
  /** Les écrans où l'on a déjà essayé de passer : leurs messages se tiennent à jour pendant qu'on corrige. */
  const tentes = new Set<number>();

  // ---------- les valeurs ----------
  const valeur = (nom: string): string => {
    const element = form.elements.namedItem(nom) as HTMLInputElement | RadioNodeList | null;
    return (element?.value ?? "").trim();
  };
  const type = () => valeur("type");
  const puces = (): HTMLInputElement[] => [...page.querySelectorAll<HTMLInputElement>(`[data-styles="${type() || "dj_set"}"] input`)];
  const styles = () => puces().filter((puce) => puce.checked).map((puce) => puce.value);
  const formulaire = (): CandidatureForm => ({ ...(Object.fromEntries(CHAMPS.map((nom) => [nom, valeur(nom)])) as Omit<CandidatureForm, "styles">), styles: styles() });

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
  const verifier = (etape: number) => fautesDe(etape, lireCandidature(formulaire()).errors);

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

  function passer() {
    tentes.add(ici);
    const fautes = verifier(ici);
    montrer(ici, fautes, true);
    if (!fautes.length) aller(ici + 1);
  }

  // ---------- le dernier écran suit le type ----------
  function suivreType() {
    const choisi = type() || "dj_set";
    const regles = config.types[choisi];
    if (regles) {
      idee.placeholder = regles.idee;
      page.querySelector<HTMLElement>("[data-aide-lien]")!.textContent = regles.lien;
    }
    page.querySelector<HTMLElement>("[data-lien-facultatif]")!.hidden = lienRequis(choisi);
    page.querySelectorAll<HTMLElement>("[data-styles]").forEach((groupe) => {
      groupe.hidden = groupe.dataset.styles !== choisi;
      // les styles d'un autre type ne partent pas
      if (groupe.hidden) groupe.querySelectorAll<HTMLInputElement>("input").forEach((puce) => (puce.checked = false));
    });
    limiterStyles();
  }

  function limiterStyles() {
    const choisis = styles().length;
    for (const puce of puces()) puce.disabled = !puce.checked && choisis >= config.stylesMax;
    if (comptePuces) comptePuces.textContent = choisis ? `${choisis} sur ${config.stylesMax}` : "";
  }

  function compter() {
    if (!compteur) return;
    const n = idee.value.length;
    compteur.textContent = `${n} / ${idee.maxLength}`;
    compteur.toggleAttribute("data-plein", n > idee.maxLength * 0.9);
  }

  // ---------- le brouillon ----------
  function sauver() {
    window.clearTimeout(minuterie);
    minuterie = window.setTimeout(() => {
      const champs = Object.fromEntries(CHAMPS.map((nom) => [nom, valeur(nom)]));
      const rempli = Object.values(champs).some(Boolean);
      try {
        if (rempli) localStorage.setItem(CLE, JSON.stringify({ ici, atteinte, champs, styles: styles() }));
        else localStorage.removeItem(CLE);
      } catch {
        return; // navigation privée : pas de brouillon
      }
      noteBrouillon.hidden = !rempli;
    }, 250);
  }

  function restaurer() {
    let brouillon: { ici?: number; atteinte?: number; champs?: Record<string, string>; styles?: string[] } | null = null;
    try {
      brouillon = JSON.parse(localStorage.getItem(CLE) ?? "null");
    } catch {
      brouillon = null;
    }
    if (!brouillon?.champs) return;
    for (const nom of CHAMPS) {
      const garde = brouillon.champs[nom] ?? "";
      const element = form.elements.namedItem(nom);
      if (element instanceof RadioNodeList) {
        // un type devenu complet depuis ne se recoche pas
        for (const option of element) if (option instanceof HTMLInputElement) option.checked = option.value === garde && !option.disabled;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = garde;
    }
    suivreType();
    for (const puce of puces()) puce.checked = brouillon.styles?.includes(puce.value) ?? false;
    atteinte = Math.min(Math.max(brouillon.atteinte ?? 1, 1), ETAPES);
    ici = Math.min(Math.max(brouillon.ici ?? 1, 1), atteinte);
    noteBrouillon.hidden = false;
  }

  // ---------- l'envoi ----------
  function direErreur(message: string) {
    erreurEnvoi.textContent = message;
    erreurEnvoi.hidden = false;
    annonce.textContent = message;
  }

  /** Ramène à l'écran du premier champ refusé par le serveur ; rend faux s'il n'y en a pas. */
  function revenirAuxFautes(erreurs: CandidatureErrors): boolean {
    for (let k = 1; k <= ETAPES; k++) {
      const fautes = fautesDe(k, erreurs);
      if (!fautes.length) continue;
      tentes.add(k);
      if (k !== ici) aller(k, { focus: false });
      montrer(k, fautes, true);
      return true;
    }
    return false;
  }

  async function envoyerTout() {
    // tout doit être juste, écran par écran : on retourne sinon à celui qui cloche
    if (revenirAuxFautes(lireCandidature(formulaire()).errors)) return;
    envoyer.disabled = true;
    envoyer.setAttribute("aria-busy", "true");
    erreurEnvoi.hidden = true;
    try {
      let verification: string | null = null;
      if (PUBLIC_TURNSTILE_SITE_KEY) {
        verification = await preuveHumaine(caseVerification);
        if (signal.aborted) return;
        if (!verification) return direErreur("La vérification anti-robots n'a pas pu se faire. Tes réponses sont gardées : réessaie.");
      }
      const reponse = await fetch(form.action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...formulaire(), site: champ("site").value, turnstile: verification }),
        signal,
      });
      const corps = (await reponse.json().catch(() => null)) as Reponse | null;
      if (reponse.ok && corps?.ok) return fini(valeur("nom"));
      const erreurs = corps?.errors ?? {};
      const { form: general, ...parChamp } = erreurs;
      const ramene = revenirAuxFautes(parChamp);
      if (general) direErreur(general);
      else if (!ramene) direErreur("L'envoi n'a pas marché. Tes réponses sont gardées : réessaie dans un moment.");
    } catch (erreur) {
      if (signal.aborted) return;
      console.error("candidater : l'envoi n'est pas passé", erreur);
      direErreur("La connexion a coupé pendant l'envoi. Tes réponses sont gardées : réessaie dans un moment.");
    } finally {
      envoyer.disabled = false;
      envoyer.removeAttribute("aria-busy");
    }
  }

  function fini(nom: string) {
    window.clearTimeout(minuterie);
    try {
      localStorage.removeItem(CLE);
    } catch {
      /* rien à effacer */
    }
    form.hidden = true;
    recu.hidden = false;
    page.querySelector<HTMLElement>("[data-recu-nom]")!.textContent = nom ? `, ${nom}` : "";
    if (!calme()) recu.classList.add("cand-zap");
    recu.focus({ preventScroll: true });
    if (panneau.getBoundingClientRect().top < 0) panneau.scrollIntoView({ block: "start", behavior: calme() ? "auto" : "smooth" });
  }

  // ---------- les gestes ----------
  form.addEventListener(
    "submit",
    (evenement) => {
      evenement.preventDefault();
      if (ici < ETAPES) passer();
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
      if (cible.name === "site") return;
      if (cible.name === "type") suivreType();
      if (cible.name === "styles") limiterStyles();
      if (cible === idee) compter();
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

  restaurer();
  suivreType();
  compter();
  page.classList.add("pret");
  aller(ici, { focus: false, zap: false });

  return () => {
    window.clearTimeout(minuterie);
    controle.abort();
  };
}
