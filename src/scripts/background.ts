// ---------- LA PLAYLIST DU FOND (clips listés dans settings.ts), ET LE ZAPPING ----------
// Un clip au hasard, puis un autre à la fin de chacun (jamais deux fois le même de suite). Un clic sur le fond lui-même
// (pas sur l'en-tête, la ligne du bas, un panneau, la feuille d'une rubrique ou un bouton) en lance un autre ; un clip
// mis par le staff (un fichier à lui) reste. Entre deux clips, on zappe : la neige tombe (neige.ts), le numéro de la
// chaîne et le titre du clip s'affichent, et l'image revient en roulant dès que le clip joue. Au chargement de l'onglet,
// le premier clip arrive ainsi, après l'allumage du téléviseur (html.allumage, tele.css). Avec « réduire les
// animations », ni neige ni roulis : le clip change, sa chaîne s'affiche. La vidéo est dans la coque : elle continue
// pendant la navigation.
import { neige } from "./neige";
import { bgPlaylist } from "./settings";

(function initBgPlaylist() {
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  const root = document.documentElement;
  const still = !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!v || !bgPlaylist.length) {
    neige.eteindre();
    root.classList.remove("allumage");
    return;
  }
  const osd = document.getElementById("osd"),
    osdNumber = document.getElementById("osdNumero"),
    osdTitle = document.getElementById("osdTitre");
  let current = -1,
    zap = 0, // le zapping en cours : un nouveau prend la main sur l'ancien
    osdTimer: ReturnType<typeof setTimeout> | undefined;
  function pickRandom() {
    let n: number;
    do {
      n = Math.floor(Math.random() * bgPlaylist.length);
    } while (n === current && bgPlaylist.length > 1);
    return n;
  }
  // la chaîne, comme sur un téléviseur : son numéro (sa place dans la liste) et son titre, quelques secondes
  function showChannel(n: number) {
    if (!osd || !osdNumber || !osdTitle) return;
    clearTimeout(osdTimer);
    osdNumber.textContent = String(n + 1).padStart(2, "0");
    osdTitle.textContent = bgPlaylist[n].titre || "";
    osd.classList.add("visible");
  }
  const hideChannel = (after: number) => {
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osd?.classList.remove("visible"), after);
  };
  /**
   * Le clip n, après la neige : au moins `minimum` ms de neige, et l'image dès que le clip joue (4 s au plus). La
   * promesse se tient aussi quand un autre zapping prend la main (sa neige reste alors).
   */
  function tune(n: number, minimum: number) {
    const id = ++zap,
      clip = bgPlaylist[n],
      from = performance.now();
    current = n;
    showChannel(n);
    if (!still) neige.allumer();
    v!.poster = clip.src.replace(/\.mp4$/, ".jpg");
    v!.src = clip.src;
    v!.load();
    v!.play().catch(() => {});
    return new Promise<void>((resolve) => {
      const ready = () => {
        v!.removeEventListener("playing", ready);
        v!.removeEventListener("error", ready);
        clearTimeout(timer);
        setTimeout(() => {
          if (id === zap) {
            neige.eteindre();
            // l'image revient en roulant, un peu trop claire, comme un poste qui accroche la chaîne
            if (!still)
              v!.animate(
                [
                  { transform: "translateY(-9%) scaleY(1.04)", filter: "brightness(2.2) contrast(1.25)" },
                  { transform: "translateY(2.5%)", filter: "brightness(1.4)", offset: 0.45 },
                  { transform: "translateY(-0.8%)", offset: 0.7 },
                  { transform: "none", filter: "none" },
                ],
                { duration: 460, easing: "cubic-bezier(0.25, 0.9, 0.35, 1)" },
              );
            hideChannel(2800);
          }
          resolve();
        }, Math.max(0, minimum - (performance.now() - from)));
      };
      v!.addEventListener("playing", ready);
      v!.addEventListener("error", ready);
      const timer = setTimeout(ready, 4000);
    });
  }
  // zapper : l'image se tord une fraction de seconde, puis la neige et la chaîne suivante
  function zapTo(n: number) {
    if (!still) v!.animate([{ filter: "none" }, { transform: "scaleY(0.94) translateY(2%)", filter: "brightness(2.6)" }], { duration: 70 });
    return tune(n, 420 + Math.random() * 280);
  }

  // l'allumage : le premier clip, après au moins 1,2 s de neige ; html.allumage s'en va quand tout est posé
  if (still) neige.eteindre();
  tune(pickRandom(), 1200).then(() =>
    setTimeout(() => root.classList.remove("allumage"), Math.max(0, 4200 - performance.now())),
  );
  if (bgPlaylist.length < 2) return; // un seul clip : l'attribut loop le répète sans couture
  v.loop = false;
  v.addEventListener("ended", () => zapTo(pickRandom())); // le suivant, au hasard (jamais le même)
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (
      e.button !== 0 ||
      target.closest?.("a, button, input, select, textarea, label, iframe, .popup, .float-item, .tete, .overlay-controls, .feuille, .direct")
    )
      return;
    if (v.currentSrc.startsWith("blob:")) return;
    zapTo(pickRandom());
  });
})();
