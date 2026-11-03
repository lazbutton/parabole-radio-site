// ---------- LES RANGÉES (src/components/residents/Rangee.astro) ----------
// Sur la page d'un artiste (ÉMISSIONS, ÉVÉNEMENTS) et sur celle d'un événement (PHOTOS) : ◂ ▸ font défiler d'une
// largeur, et s'éteignent au bout ; sans débordement, elles disparaissent.

const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function brancherLesRangees(racine: ParentNode) {
  for (const rangee of racine.querySelectorAll<HTMLElement>(".rangee")) {
    const liste = rangee.querySelector<HTMLElement>(".rangee-liste");
    const fleches = [...rangee.querySelectorAll<HTMLButtonElement>(".rangee-fleche")];
    if (!liste) continue;
    const suivre = () => {
      const deborde = liste.scrollWidth > liste.clientWidth + 2;
      rangee.toggleAttribute("data-deborde", deborde);
      for (const fleche of fleches) {
        const sens = Number(fleche.dataset.sens);
        fleche.disabled = !deborde || (sens < 0 ? liste.scrollLeft <= 2 : liste.scrollLeft + liste.clientWidth >= liste.scrollWidth - 2);
      }
    };
    for (const fleche of fleches)
      fleche.addEventListener("click", () => {
        liste.scrollBy({ left: Number(fleche.dataset.sens) * liste.clientWidth * 0.85, behavior: calme() ? "auto" : "smooth" });
      });
    liste.addEventListener("scroll", suivre, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(suivre).observe(liste);
    suivre();
  }
}
