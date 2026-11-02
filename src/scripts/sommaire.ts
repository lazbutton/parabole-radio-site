// ---------- LE SOMMAIRE, sur téléphone : le menu en page de télétexte ----------
// La touche MENU de l'en-tête (TopBar.astro) ouvre la page P100 entre l'en-tête et la ligne du bas : les rubriques avec
// leur numéro de page, la rubrique ouverte allumée, et la source du son (RADIO / VIDÉO, qui n'a pas la place dans la
// ligne ON AIR d'un téléphone). Tant qu'il est ouvert, le focus y reste ; Échap, ✕, un choix, un toucher ailleurs ou un
// changement de page le referment. Sur un écran plus large, le menu est là : le sommaire ne s'ouvre pas.
import { mettreALHeure } from "./teletexte";

const bouton = document.getElementById("sommaireOuvrir");
const sommaire = document.getElementById("sommaire");
const croix = document.getElementById("sommaireFermer");
const source = document.getElementById("sommaireSource");
const sourceDuSon = document.getElementById("soundToggle");

/** La touche du sommaire montre la même source que celle de la ligne ON AIR (audio.ts tient celle-là). */
function suivreLaSource() {
  if (!source || !sourceDuSon) return;
  source.dataset.mode = sourceDuSon.dataset.mode;
  const label = sourceDuSon.getAttribute("aria-label");
  if (label) source.setAttribute("aria-label", label);
}

function ouvrir() {
  if (!sommaire || !bouton) return;
  sommaire.hidden = false;
  bouton.setAttribute("aria-expanded", "true");
  suivreLaSource();
  mettreALHeure();
  (sommaire.querySelector<HTMLElement>('a[aria-current="page"]') ?? sommaire.querySelector<HTMLElement>("a"))?.focus();
}
function fermer(rendreFocus = true) {
  if (!sommaire || sommaire.hidden) return;
  sommaire.hidden = true;
  bouton?.setAttribute("aria-expanded", "false");
  if (rendreFocus) bouton?.focus();
}

bouton?.addEventListener("click", () => (sommaire?.hidden ? ouvrir() : fermer()));
croix?.addEventListener("click", () => fermer());
source?.addEventListener("click", () => {
  sourceDuSon?.click();
  suivreLaSource();
});
sommaire?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    fermer();
    return;
  }
  if (e.key !== "Tab") return;
  // le focus tourne dans le sommaire
  const touches = [...sommaire.querySelectorAll<HTMLElement>("a, button")].filter((el) => el.offsetParent !== null);
  const premiere = touches[0],
    derniere = touches[touches.length - 1];
  if (e.shiftKey && document.activeElement === premiere) {
    e.preventDefault();
    derniere.focus();
  } else if (!e.shiftKey && document.activeElement === derniere) {
    e.preventDefault();
    premiere.focus();
  }
});
document.addEventListener("pointerdown", (e) => {
  const cible = e.target as Node;
  if (sommaire && !sommaire.hidden && !sommaire.contains(cible) && !bouton?.contains(cible)) fermer(false);
});
document.addEventListener("astro:before-preparation", () => fermer(false));
window.matchMedia?.("(min-width: 821px)").addEventListener?.("change", (e) => {
  if (e.matches) fermer(false);
});
