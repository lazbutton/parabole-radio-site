// ---------- À PROPOS : LE FILM QU'ON LANCE, ET LA PAGE QUI S'EFFACE ----------
// La page À propos (src/pages/a-propos.astro) garde l'image fixe du film en fond (le mode photo de background.ts) et
// un grand ▶ au centre. Un clic lance le film par-dessus, avec le son, comme on change de chaîne : la neige, puis
// l'image. La radio lui prête le son (audio.ts) et le reprend quand il finit, qu'on le ferme ou qu'on quitte la page.
// En marche, si la souris ne bouge plus pendant 2 s, la page s'efface (les pages et le pointeur ; l'en-tête et la régie
// restent) ; elle revient au moindre mouvement, au doigt, à la molette ou au clavier. En pause, tout reste. Un clic sur
// l'image elle-même met en pause ou relance. Le volume de l'en-tête règle aussi le film. Avec « réduire les
// animations », ni neige ni fondu. Branché sur astro:page-load : à chaque arrivée sur la page.
import { radioControl } from "./audio";
import { neige } from "./neige";

/** Sans bouger la souris pendant ce temps, la page s'efface devant le film. */
const REPOS_MS = 2000;
/** Le film qui s'ouvre ou se ferme : la neige, le temps de changer de chaîne. */
const NEIGE_MS = 260;

const root = document.documentElement;
const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const minutes = (secondes: number) => {
  const s = Math.max(0, Math.floor(secondes));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Ce qu'il faut défaire en quittant la page. */
let quitter: (() => void) | null = null;

document.addEventListener("astro:page-load", () => {
  quitter?.();
  quitter = null;
  const page = document.querySelector<HTMLElement>("[data-apropos]");
  const film = page?.querySelector<HTMLVideoElement>("video[data-film]");
  if (page && film) quitter = brancher(page, film);
});
// En quittant la page, le film s'arrête et rend le son ; l'en-tête revient.
document.addEventListener("astro:before-swap", () => {
  quitter?.();
  quitter = null;
});

function brancher(page: HTMLElement, film: HTMLVideoElement): () => void {
  const lancer = page.querySelector<HTMLButtonElement>("[data-film-lancer]");
  const pause = page.querySelector<HTMLButtonElement>("[data-film-pause]");
  const fermer = page.querySelector<HTMLButtonElement>("[data-film-fermer]");
  const avance = page.querySelector<HTMLInputElement>("[data-film-avance]");
  const temps = page.querySelector<HTMLElement>("[data-film-temps]");
  const volume = document.getElementById("playerVolume") as HTMLInputElement | null;
  const muet = document.getElementById("playerMute");
  // Tous les écouteurs partent d'un coup en quittant la page.
  const fin = new AbortController();
  const { signal } = fin;
  /** Rend le son à la radio ; null tant que le film ne l'a pas pris. */
  let rendre: (() => void) | null = null;
  let repos: ReturnType<typeof setTimeout> | undefined;
  let neigeFin: ReturnType<typeof setTimeout> | undefined;
  /** Le prochain clic ne fait que réveiller la page (un doigt sur l'écran pendant qu'elle est effacée). */
  let avaler = false;
  let x = -1,
    y = -1;

  const enMarche = () => !film.paused && !film.ended;
  const effacee = () => root.classList.contains("film-au-repos");

  /** Le volume de l'en-tête : sa rampe et sa touche muet règlent aussi le film. */
  const regler = () => {
    if (volume) film.volume = Math.min(1, Math.max(0, Number(volume.value) / 100));
    film.muted = muet?.getAttribute("aria-pressed") === "true";
  };

  /** La page revient ; le film en marche, elle s'effacera de nouveau dans 2 s. */
  function reveiller() {
    root.classList.remove("film-au-repos");
    clearTimeout(repos);
    if (enMarche()) repos = setTimeout(() => root.classList.add("film-au-repos"), REPOS_MS);
  }

  /** La neige un instant, comme quand on change de chaîne. */
  function zapper(duree = NEIGE_MS) {
    if (calme()) return;
    neige.allumer();
    clearTimeout(neigeFin);
    neigeFin = setTimeout(() => neige.eteindre(), duree);
  }

  function rendreLeSon() {
    rendre?.();
    rendre = null;
  }

  async function jouer() {
    regler();
    rendre ??= radioControl?.preterLeSon() ?? null;
    // La neige tombe jusqu'à la première image (2 s au plus) : « playing » l'éteint.
    if (!root.classList.contains("film-ouvert")) zapper(2000);
    try {
      await film.play();
    } catch {
      // le navigateur refuse, ou le fichier ne se lit pas : la page reste telle quelle, le son revient
      neige.eteindre();
      rendreLeSon();
    }
  }

  /** Le film se ferme : l'image fixe revient, la page aussi, et le son à la radio. */
  function fermerLeFilm() {
    film.pause();
    clearTimeout(repos);
    const ouvert = root.classList.contains("film-ouvert");
    root.classList.remove("film-ouvert", "film-en-marche", "film-au-repos");
    if (ouvert) zapper();
    rendreLeSon();
    try {
      film.currentTime = 0;
    } catch {
      /* pas encore chargé */
    }
    lancer?.focus({ preventScroll: true });
  }

  function montrerLeTemps() {
    const total = Number.isFinite(film.duration) ? film.duration : Number(avance?.max) || 0;
    if (temps) temps.textContent = total ? `${minutes(film.currentTime)} / ${minutes(total)}` : minutes(film.currentTime);
    if (avance && document.activeElement !== avance) {
      if (total) avance.max = String(total);
      avance.value = String(film.currentTime);
    }
    // la partie passée du fil, en jaune
    avance?.style.setProperty("--avance", `${total ? Math.min(100, (film.currentTime / total) * 100) : 0}%`);
  }

  film.addEventListener(
    "playing",
    () => {
      const premiere = !root.classList.contains("film-ouvert");
      // Un film qui repart après un chargement (« waiting ») ne réveille pas la page : seulement un départ ou une reprise.
      const reprise = !root.classList.contains("film-en-marche");
      root.classList.add("film-ouvert", "film-en-marche");
      clearTimeout(neigeFin);
      neigeFin = setTimeout(() => neige.eteindre(), calme() ? 0 : 160);
      pause?.setAttribute("aria-label", "Mettre le film en pause");
      // Le grand ▶ disparaît : la main passe à la régie.
      if (premiere && document.activeElement === lancer) pause?.focus({ preventScroll: true });
      if (reprise) reveiller();
    },
    { signal },
  );
  film.addEventListener(
    "pause",
    () => {
      root.classList.remove("film-en-marche");
      pause?.setAttribute("aria-label", "Reprendre le film");
      reveiller();
    },
    { signal },
  );
  film.addEventListener("ended", fermerLeFilm, { signal });
  film.addEventListener("timeupdate", montrerLeTemps, { signal });
  film.addEventListener("loadedmetadata", montrerLeTemps, { signal });
  film.addEventListener(
    "error",
    () => {
      if (!film.getAttribute("src")) return;
      fermerLeFilm();
      if (lancer) lancer.disabled = true;
      lancer?.querySelector("[data-film-nom]")?.replaceChildren("Le film ne se lance pas pour le moment");
    },
    { signal },
  );

  lancer?.addEventListener("click", () => void jouer(), { signal });
  pause?.addEventListener("click", () => (enMarche() ? film.pause() : void jouer()), { signal });
  fermer?.addEventListener("click", fermerLeFilm, { signal });
  avance?.addEventListener(
    "input",
    () => {
      film.currentTime = Number(avance.value);
      montrerLeTemps();
    },
    { signal },
  );
  volume?.addEventListener("input", regler, { signal });
  muet?.addEventListener("click", regler, { signal });
  // Une touche du son de l'en-tête a repris la main pour la radio : le film s'arrête, sans rien rendre.
  document.addEventListener(
    "parabole:son-repris",
    () => {
      rendre = null;
      film.pause();
    },
    { signal },
  );

  // Un clic sur l'image elle-même (pas sur une page, un lien ou une touche) met en pause ou relance le film.
  page.addEventListener(
    "click",
    (e) => {
      if (!root.classList.contains("film-ouvert") || e.button !== 0) return;
      if ((e.target as Element).closest("a, button, input, .apropos-panneau, .apropos-regie, .apropos-mentions")) return;
      if (enMarche()) film.pause();
      else void jouer();
    },
    { signal },
  );

  // Réveiller la page : un vrai mouvement de souris (Chrome en simule un, immobile, quand l'image change sous le
  // pointeur), un doigt, la molette, une touche du clavier. Un doigt posé sur la page effacée ne fait que la réveiller.
  document.addEventListener(
    "pointermove",
    (e) => {
      if (Math.abs(e.clientX - x) < 3 && Math.abs(e.clientY - y) < 3) return;
      x = e.clientX;
      y = e.clientY;
      if (root.classList.contains("film-ouvert")) reveiller();
    },
    { signal, passive: true },
  );
  document.addEventListener(
    "pointerdown",
    () => {
      avaler = effacee();
      if (root.classList.contains("film-ouvert")) reveiller();
    },
    { signal, capture: true, passive: true },
  );
  // le doigt glisse (la page défile) : aucun clic ne suivra, le prochain ne sera pas avalé
  document.addEventListener("pointercancel", () => (avaler = false), { signal, passive: true });
  document.addEventListener(
    "click",
    (e) => {
      if (!avaler) return;
      avaler = false;
      e.preventDefault();
      e.stopPropagation();
    },
    { signal, capture: true },
  );
  for (const type of ["keydown", "wheel"] as const)
    document.addEventListener(
      type,
      () => {
        if (root.classList.contains("film-ouvert")) reveiller();
      },
      { signal, passive: true },
    );

  return () => {
    fin.abort();
    clearTimeout(repos);
    clearTimeout(neigeFin);
    film.pause();
    root.classList.remove("film-ouvert", "film-en-marche", "film-au-repos");
    neige.eteindre();
    rendreLeSon();
  };
}
