// ---------- LA PAGE D'UN ÉVÉNEMENT (src/pages/evenements/[slug].astro) ----------
// Les photos défilent en rangée avec ◂ ▸ (rangees.ts) ; une photo touchée s'ouvre en grand, dans une visionneuse qui
// passe d'une photo à l'autre avec ◂ ▸ ou les flèches du clavier, dans un éclair de neige, comme on zappe, et se ferme
// avec ×, Échap ou un clic à côté. « ◂ ÉVÉNEMENTS » revient en arrière quand on arrive de la liste, pour la retrouver
// au même endroit (router.ts). Branché sur astro:page-load : à chaque arrivée sur la page d'un événement.
import { brancherLesRangees } from "./rangees";
import { PAGE_AVANT } from "./router";

document.addEventListener("astro:page-load", () => {
  const racine = document.querySelector<HTMLElement>("[data-evenement]");
  if (!racine) return;

  brancherLesRangees(racine);

  // La visionneuse des photos
  const visionneuse = racine.querySelector<HTMLDialogElement>(".visionneuse");
  const vignettes = [...racine.querySelectorAll<HTMLButtonElement>("[data-photo]")];
  if (visionneuse && vignettes.length) {
    const image = visionneuse.querySelector<HTMLImageElement>(".visionneuse-image")!;
    const legende = visionneuse.querySelector<HTMLElement>(".visionneuse-legende")!;
    const numero = visionneuse.querySelector<HTMLElement>(".visionneuse-numero")!;
    const cadre = visionneuse.querySelector<HTMLElement>(".visionneuse-cadre")!;
    const fleches = [...visionneuse.querySelectorAll<HTMLButtonElement>("[data-sens]")];
    let rang = 0;

    const montrer = (n: number) => {
      rang = (n + vignettes.length) % vignettes.length;
      const vignette = vignettes[rang]!;
      image.removeAttribute("srcset");
      if (vignette.dataset.srcset) {
        image.srcset = vignette.dataset.srcset;
        image.sizes = "100vw";
      }
      image.src = vignette.dataset.src ?? "";
      image.alt = vignette.dataset.alt ?? "";
      legende.textContent = vignette.dataset.legende ?? "";
      legende.hidden = !vignette.dataset.legende;
      numero.textContent = `${rang + 1} / ${vignettes.length}`;
      for (const fleche of fleches) fleche.hidden = vignettes.length < 2;
      // l'éclair de neige, rejoué à chaque photo
      cadre.removeAttribute("data-zap");
      void cadre.offsetWidth;
      cadre.setAttribute("data-zap", "");
    };

    vignettes.forEach((vignette, n) =>
      vignette.addEventListener("click", () => {
        montrer(n);
        visionneuse.showModal();
      }),
    );
    for (const fleche of fleches) fleche.addEventListener("click", () => montrer(rang + Number(fleche.dataset.sens)));
    visionneuse.querySelector(".visionneuse-fermer")?.addEventListener("click", () => visionneuse.close());
    // un clic à côté de la photo, sur le fond sombre, ferme
    visionneuse.addEventListener("click", (e) => {
      if (e.target === visionneuse) visionneuse.close();
    });
    visionneuse.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      montrer(rang + (e.key === "ArrowLeft" ? -1 : 1));
    });
    // en quittant la photo ouverte, on retrouve sa vignette
    visionneuse.addEventListener("close", () => vignettes[rang]?.focus({ preventScroll: false }));
  }

  // ◂ ÉVÉNEMENTS : arrivé de la liste, on y revient en arrière, à la même place
  racine.querySelector<HTMLAnchorElement>("[data-retour]")?.addEventListener("click", (e) => {
    let avant = "";
    try {
      avant = sessionStorage.getItem(PAGE_AVANT) || "";
    } catch (err) {
      /* pas de mémoire : le lien suffit */
    }
    if (/^\/evenements\/?(\?|$)/.test(avant) && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      history.back();
    }
  });
});

// une navigation pendant que la visionneuse est ouverte la referme d'abord
document.addEventListener("astro:before-preparation", () => document.querySelector<HTMLDialogElement>(".visionneuse[open]")?.close());
