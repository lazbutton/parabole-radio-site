// ---------- LA NAVIGATION : seul <main id="page"> change ----------
// Le ClientRouter d'Astro charge la page demandée sans recharger l'onglet. Sa fonction de remplacement habituelle
// remplace tout le <body> et y redépose les éléments marqués transition:persist : ils sont déplacés, et un <iframe>
// déplacé se recharge (le chat perdrait sa conversation). Celle-ci ne touche qu'au contenu de la page : la tête du
// document (titre, styles), les attributs de <html> (data-page) et <main id="page">. Le fond, la barre du haut, le
// bandeau, les panneaux et le chat ne bougent pas d'un pixel ; le son et la vidéo continuent.
import { swapFunctions, type TransitionBeforeSwapEvent } from "astro:transitions/client";
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
    // les attributs de <html> viennent de la nouvelle page, sauf son style : la coque y range --band-h (panels.ts)
    const rootStyle = document.documentElement.getAttribute("style");
    swapRootAttributes(e.newDocument);
    if (rootStyle) document.documentElement.setAttribute("style", rootStyle);
    swapHeadElements(e.newDocument);
    const restoreFocus = saveFocus();
    current.replaceWith(next);
    reifyMedia(next);
    restoreFocus();
  };
});

// Après le remplacement : la rubrique ouverte dans le menu, puis ce qui dépend de la page (PROGRAMMATION épinglé sur
// l'accueil, place des panneaux, texte « NOW PLAYING » de l'accueil).
document.addEventListener("astro:after-swap", () => {
  const page = document.documentElement.dataset.page;
  document.querySelectorAll<HTMLAnchorElement>(".menu a").forEach((a) => {
    if (a.dataset.page === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  pageChanged();
  refreshNowPlaying();
});

// Le logo ramène à l'accueil ; déjà sur l'accueil, il ne recharge rien (et un double-clic y ouvre le mode staff).
document.getElementById("logoSquare")?.addEventListener("click", (e) => {
  if (location.pathname === "/") e.preventDefault();
});
