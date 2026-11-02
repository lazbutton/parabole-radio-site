// ---------- JUSTE AVANT (le PREVIOUS de la maquette), dans la ligne ON AIR ----------
// La touche JUSTE AVANT, ou un clic sur le texte qui défile (la seule façon sur téléphone, où la touche n'a pas la
// place), déplie une page de télétexte sous la ligne : le morceau d'avant puis celui qui passe, chacun avec les logos des
// plateformes où Hopper le trouve (hopper.ts), et TOUT L'HISTORIQUE, qui ouvre le panneau HISTORIQUE. Le morceau d'avant
// vient de l'historique de la station (HISTORY_URL), complété des morceaux vus passer sur cette page (state.ts), comme
// dans HISTORIQUE ; Radiocompas le donne aussi dans le direct (previous). Échap, un clic ailleurs ou un changement de
// page la referment.
import type { History, Track } from "../lib/station/types";
import { samePlay } from "./history";
import { askHopper, fillLogos } from "./hopper";
import { popups, togglePopup } from "./panels";
import { HISTORY_URL, STATION_TIMEZONE } from "./settings";
import { station } from "./state";
import { mettreALHeure } from "./teletexte";
import { escapeHtml, fetchJson, withQuery } from "./util";

const page = document.getElementById("avantPage");
const morceaux = document.getElementById("avantMorceaux");
const touche = document.getElementById("avantTouche");
const ticker = document.getElementById("playerTicker");
const historique = document.getElementById("avantHistorique");
const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, hour: "2-digit", minute: "2-digit" });

/** Le morceau à l'antenne, s'il y en a un (pas « en attente »). */
function enCours(): Track | null {
  const np = station.now;
  return np && np.title && !/en attente/i.test(np.title) ? np : null;
}

/** Le morceau d'avant : le plus récent de l'historique qui n'est pas celui qui passe. Null si on ne le sait pas. */
async function avant(): Promise<Track | null> {
  const np = station.now;
  if (!HISTORY_URL) return np && np.previous && np.previous.title ? np.previous : null;
  const { items = [] } = await fetchJson<History>(withQuery(HISTORY_URL, "limit=5"), { cache: "no-store" });
  const passe = enCours();
  return (
    items
      .concat(station.played.filter((p) => !items.some((it) => samePlay(it, p))))
      .filter((it) => it.title && !samePlay(it, passe))
      .sort((a, b) => (Date.parse(b.played_at!) || 0) - (Date.parse(a.played_at!) || 0))[0] ?? null
  );
}

/** Un morceau de la page : quand, le titre, l'artiste, et l'emplacement de ses logos (rempli par Hopper). */
function bloc(quand: string, t: Track | null, vide: string) {
  const temps = t && t.played_at && Number.isFinite(Date.parse(t.played_at)) ? heure.format(new Date(t.played_at)) : "";
  return (
    `<div class="avant-morceau"><p class="avant-quand"><span>${escapeHtml(quand)}</span><span>${escapeHtml(temps)}</span></p>` +
    (t
      ? `<p class="avant-titre">${escapeHtml(t.title)}</p>${t.artist ? `<p class="avant-artiste">${escapeHtml(t.artist)}</p>` : ""}` +
        `<span class="direct-plateformes hppr-logos" hidden></span>`
      : `<p class="avant-titre">${escapeHtml(vide)}</p>`) +
    `</div>`
  );
}

async function remplir() {
  if (!morceaux) return;
  const passe = enCours();
  const remplirLogos = (avantLui: Track | null) => {
    const slots = morceaux.querySelectorAll<HTMLElement>(".hppr-logos");
    const pistes = [avantLui, passe].filter(Boolean) as Track[];
    slots.forEach((slot, i) => fillLogos(slot, pistes[i] ?? null));
    askHopper(pistes);
  };
  // d'abord ce qu'on sait déjà, puis le morceau d'avant quand l'historique répond
  morceaux.innerHTML = bloc("Avant", null, "Recherche du morceau…") + bloc("En ce moment", passe, "Parabole Radio");
  try {
    const precedent = await avant();
    if (page?.hidden) return;
    morceaux.innerHTML = bloc("Avant", precedent, "Rien d'enregistré pour l'instant.") + bloc("En ce moment", passe, "Parabole Radio");
    remplirLogos(precedent);
  } catch (e) {
    morceaux.innerHTML = bloc("Avant", null, "Historique indisponible pour le moment.") + bloc("En ce moment", passe, "Parabole Radio");
    remplirLogos(null);
  }
}

// la touche et le texte qui défile ouvrent la même page : les deux disent si elle est ouverte
const deplie = (oui: boolean) => [touche, ticker].forEach((el) => el?.setAttribute("aria-expanded", String(oui)));
function ouvrir() {
  if (!page) return;
  page.hidden = false;
  deplie(true);
  mettreALHeure();
  remplir();
}
function fermer(rendreFocus?: HTMLElement | null) {
  if (!page || page.hidden) return;
  page.hidden = true;
  deplie(false);
  rendreFocus?.focus();
}
const basculer = () => (page?.hidden ? ouvrir() : fermer());

touche?.addEventListener("click", basculer);
ticker?.addEventListener("click", basculer);
historique?.addEventListener("click", () => {
  fermer();
  if (!popups.lastplayed.classList.contains("open")) togglePopup("lastplayed");
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !page || page.hidden) return;
  const dedans = page.contains(document.activeElement) || document.activeElement === touche || document.activeElement === ticker;
  fermer(dedans ? (document.activeElement === ticker ? ticker : touche) : null);
});
document.addEventListener("pointerdown", (e) => {
  const cible = e.target as Node;
  if (page && !page.hidden && !page.contains(cible) && !touche?.contains(cible) && !ticker?.contains(cible)) fermer();
});
document.addEventListener("astro:before-preparation", () => fermer());
