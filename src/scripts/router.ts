// ---------- LA NAVIGATION : seul <main id="page"> change ----------
// Le ClientRouter d'Astro charge la page demandée sans recharger l'onglet. Sa fonction de remplacement habituelle
// remplace tout le <body> et y redépose les éléments marqués transition:persist : ils sont déplacés, et un <iframe>
// déplacé se recharge (le chat perdrait sa conversation). Celle-ci ne touche qu'au contenu de la page : la tête du
// document (titre, styles), les attributs de <html> (data-page) et <main id="page">. Le fond, l'en-tête, la ligne du
// bas, les panneaux et le chat ne bougent pas d'un pixel ; le son et la vidéo continuent.
import { swapFunctions, type TransitionBeforePreparationEvent, type TransitionBeforeSwapEvent } from "astro:transitions/client";
import { neige } from "./neige";
import { refreshNowPlaying } from "./nowplaying";
import { pageChanged } from "./panels";

// Les <video> et <audio> d'une page analysée par DOMParser sont inertes : le navigateur ne les initialise que créés
// dans le document vivant. Astro les recrée ainsi dans sa propre fonction de remplacement ; même chose ici pour ceux du
// contenu (aucun pour l'instant, mais les pages d'archives en auront).
function reifyMedia(root: Element) {
  for (const media of root.querySelectorAll("video, audio")) {
    const fresh = document.createElement(media.localName);
    for (const attr of media.attributes) fresh.setAttribute(attr.name, attr.value);
    fresh.innerHTML = media.innerHTML;
    if (fresh.hasAttribute("muted")) (fresh as HTMLMediaElement).muted = true;
    media.replaceWith(fresh);
  }
}

document.addEventListener("astro:before-swap", (event) => {
  const e = event as TransitionBeforeSwapEvent;
  e.swap = () => {
    const current = document.getElementById("page");
    const next = e.newDocument.getElementById("page");
    // une page sans la coque ne peut pas se greffer sur celle-ci : on la charge normalement
    if (!current || !next) return void location.assign(e.to.href);
    const { deselectScripts, swapRootAttributes, swapHeadElements, saveFocus } = swapFunctions;
    deselectScripts(e.newDocument);
    // les attributs de <html> viennent de la nouvelle page, sauf son style (la coque y range --band-h, panels.ts), le
    // mode photo du fond, que background.ts garde ou retire selon la page qui arrive, et la place de la ligne ARCHIVE,
    // qui reste ouverte d'une page à l'autre (archive.ts)
    const rootStyle = document.documentElement.getAttribute("style");
    const enPhoto = document.documentElement.classList.contains("fond-en-photo");
    const archive = document.documentElement.classList.contains("archive-ouverte");
    swapRootAttributes(e.newDocument);
    if (rootStyle) document.documentElement.setAttribute("style", rootStyle);
    if (enPhoto) document.documentElement.classList.add("fond-en-photo");
    if (archive) document.documentElement.classList.add("archive-ouverte");
    swapHeadElements(e.newDocument);
    const restoreFocus = saveFocus();
    current.replaceWith(next);
    reifyMedia(next);
    restoreFocus();
  };
});

// Après le remplacement : la rubrique ouverte dans le menu et dans le sommaire des téléphones, puis ce qui dépend de la
// page (PROGRAMMATION épinglé sur l'accueil, place des panneaux, texte « NOW PLAYING » de l'accueil).
document.addEventListener("astro:after-swap", () => {
  const page = document.documentElement.dataset.page;
  document.querySelectorAll<HTMLAnchorElement>(".menu a, .sommaire-liste a").forEach((a) => {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  pageChanged();
  refreshNowPlaying(); // la ligne ON AIR aussi : les phrases sur l'accueil, ce qui passe ailleurs
});

// Le logo ramène à l'accueil ; déjà sur l'accueil, il ne recharge rien (et un double-clic y ouvre le mode staff).
document.getElementById("logoSquare")?.addEventListener("click", (e) => {
  if (location.pathname === "/") e.preventDefault();
});

// ---------- LE RETOUR AU MÊME ENDROIT, ET LA NEIGE VERS UN ARTISTE ----------
// Les rubriques défilent dans <main id="page">, pas dans la fenêtre : le ClientRouter ne sait pas y retrouver sa place.
// Avant de quitter une page, on garde sa position (par adresse, le temps de l'onglet) ; au retour arrière ou avant, on
// la rend. On garde aussi l'adresse de la page qu'on quitte : la page d'un artiste en déduit si « ◂ RÉSIDENTS » peut
// simplement revenir en arrière (src/scripts/artiste.ts), celle d'un événement si « ◂ ÉVÉNEMENTS » le peut
// (evenement.ts), celle d'une émission si « ◂ ÉMISSIONS » le peut (emissions.ts). Vers la page d'une émission, d'un
// artiste ou d'un événement, la neige tombe dès le départ : background.ts la retire quand son image est là.
const POSITIONS = "parabole_defilement";
export const PAGE_AVANT = "parabole_page_avant";
const lire = (): Record<string, number> => {
  try {
    return JSON.parse(sessionStorage.getItem(POSITIONS) || "{}") || {};
  } catch (e) {
    return {};
  }
};
let retour = false;
document.addEventListener("astro:before-preparation", (event) => {
  const e = event as TransitionBeforePreparationEvent;
  // la page qu'on quitte : e.from, car au retour arrière l'adresse de l'onglet est déjà celle d'avant
  const ici = e.from.pathname + e.from.search;
  try {
    const positions = lire();
    positions[ici] = document.getElementById("page")?.scrollTop ?? 0;
    sessionStorage.setItem(POSITIONS, JSON.stringify(positions));
    sessionStorage.setItem(PAGE_AVANT, ici);
  } catch (err) {
    /* stockage refusé : on repartira du haut */
  }
  retour = e.navigationType === "traverse";
  const calme = !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!calme && /^\/(emissions|residents|evenements)\/[^/]+\/?$/.test(e.to.pathname)) neige.allumer();
});
document.addEventListener("astro:page-load", () => {
  if (!retour) return;
  retour = false;
  const y = lire()[location.pathname + location.search];
  const page = document.getElementById("page");
  // après les scripts de la page, qui peuvent filtrer ce qu'elle montre (residents.ts)
  if (page && y) requestAnimationFrame(() => (page.scrollTop = y));
});
