// ---------- LA PLAYLIST DU FOND (clips listés dans settings.ts) ----------
// Un clip au hasard, puis un autre à la fin de chacun (jamais deux fois le même de suite). Un clic sur le fond lui-même
// (pas sur la barre du haut, le bandeau, un panneau, la feuille d'une rubrique ou un bouton) en lance un autre ; un clip
// mis par le staff (un fichier à lui) reste. La vidéo est dans la coque : elle continue pendant la navigation.
import { bgPlaylist } from "./settings";

(function initBgPlaylist() {
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  if (!v || !bgPlaylist.length) return;
  let current = -1;
  function pickRandom() {
    let n: number;
    do {
      n = Math.floor(Math.random() * bgPlaylist.length);
    } while (n === current && bgPlaylist.length > 1);
    current = n;
    return bgPlaylist[n];
  }
  function playRandom() {
    const src = pickRandom();
    v!.poster = src.replace(/\.mp4$/, ".jpg");
    v!.src = src;
    v!.load();
    v!.play().catch(() => {});
  }
  playRandom(); // un clip au hasard pour commencer
  if (bgPlaylist.length < 2) return; // un seul clip : l'attribut loop le répète sans couture
  v.loop = false;
  v.addEventListener("ended", playRandom); // le suivant, au hasard (jamais le même)
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (
      e.button !== 0 ||
      target.closest?.("a, button, input, select, textarea, label, iframe, .popup, .float-item, .top-bar, .overlay-controls, .feuille")
    )
      return;
    if (v.currentSrc.startsWith("blob:")) return;
    playRandom();
  });
})();
