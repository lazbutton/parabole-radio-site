// ---------- LA PAGE D'UN ARTISTE (src/pages/residents/[slug].astro) ----------
// La bio se coupe à huit lignes, avec LIRE LA SUITE ; sa prochaine émission s'affiche à l'heure de Paris (revue à la
// minute) ; les rangées défilent avec ◂ ▸ ; les
// flèches ← → du clavier zappent vers l'artiste d'avant ou d'après, comme les touches du haut, dont les photos sont
// chargées d'avance ; et « ◂ RÉSIDENTS » revient en arrière quand on arrive de la liste, pour la retrouver au même
// endroit, filtres compris (router.ts). Branché sur astro:page-load : à chaque arrivée sur une page d'artiste.
import { brancherLesRangees } from "./rangees";
import { PAGE_AVANT } from "./router";
import { STATION_TIMEZONE } from "./settings";

const jourDe = new Intl.DateTimeFormat("fr-CA", { timeZone: STATION_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const heureDe = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, hour: "2-digit", minute: "2-digit" });
const dateDe = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, weekday: "short", day: "numeric", month: "short" });
let horloge: ReturnType<typeof setInterval> | undefined;

/** « Aujourd'hui · 21:00 », « Demain · 21:00 » ou « jeu. 6 nov. · 21:00 », à l'heure de Paris. */
function quand(debut: Date): string {
  const aujourdhui = jourDe.format(new Date());
  const demain = jourDe.format(new Date(Date.now() + 24 * 3_600_000));
  const ce = jourDe.format(debut);
  const jour = ce === aujourdhui ? "Aujourd'hui" : ce === demain ? "Demain" : dateDe.format(debut);
  return `${jour} · ${heureDe.format(debut)}`;
}

document.addEventListener("astro:page-load", () => {
  clearInterval(horloge);
  const racine = document.querySelector<HTMLElement>("[data-artiste]");
  if (!racine) return;

  // La bio : coupée à huit lignes, si elle les dépasse
  const bio = racine.querySelector<HTMLElement>("[data-bio]");
  const suite = racine.querySelector<HTMLButtonElement>(".artiste-suite");
  if (bio && suite) {
    suite.hidden = bio.scrollHeight <= bio.clientHeight + 2;
    suite.addEventListener("click", () => {
      const ouvert = !bio.hasAttribute("data-ouvert");
      bio.toggleAttribute("data-ouvert", ouvert);
      suite.setAttribute("aria-expanded", String(ouvert));
      suite.textContent = ouvert ? "Replier ▴" : "Lire la suite ▾";
    });
  }

  // Sa prochaine émission, la plus proche à venir
  const antenne = racine.querySelector<HTMLElement>(".artiste-antenne");
  let prochaines: string[] = [];
  try {
    prochaines = JSON.parse(antenne?.dataset.prochaines || "[]");
  } catch (e) {
    /* rien à annoncer */
  }
  const annoncer = () => {
    if (!antenne) return;
    const prochaine = prochaines.find((debut) => Date.parse(debut) > Date.now());
    antenne.hidden = !prochaine;
    antenne.textContent = prochaine ? `Prochaine émission · ${quand(new Date(prochaine))}` : "";
  };
  annoncer();
  if (prochaines.length) horloge = setInterval(annoncer, 30_000);

  // Les rangées : ◂ ▸ font défiler d'une largeur (rangees.ts)
  brancherLesRangees(racine);

  // Les photos des deux voisins, chargées d'avance : le zapping n'attend pas
  const charger = () => {
    for (const a of racine.querySelectorAll<HTMLAnchorElement>("[data-zap][data-photo]")) new Image().src = a.dataset.photo!;
  };
  if ("requestIdleCallback" in window) requestIdleCallback(charger);
  else setTimeout(charger, 800);

  // ◂ RÉSIDENTS : arrivé de la liste, on y revient en arrière, à la même place et avec les mêmes filtres
  racine.querySelector<HTMLAnchorElement>("[data-retour]")?.addEventListener("click", (e) => {
    let avant = "";
    try {
      avant = sessionStorage.getItem(PAGE_AVANT) || "";
    } catch (err) {
      /* pas de mémoire : le lien suffit */
    }
    if (/^\/residents\/?(\?|$)/.test(avant) && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      history.back();
    }
  });
});

// ← → : zapper d'un artiste à l'autre, sauf quand les flèches servent déjà à autre chose (un champ, le volume, une
// rangée qui défile, l'index)
document.addEventListener("keydown", (e) => {
  if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const cible = e.target as Element | null;
  if (cible?.closest?.("input, textarea, select, [contenteditable], .rangee-liste, .index-az, .teletexte")) return;
  const zap = document.querySelector<HTMLAnchorElement>(`[data-artiste] [data-zap="${e.key === "ArrowLeft" ? "precedent" : "suivant"}"]`);
  if (!zap) return;
  e.preventDefault();
  zap.click();
});
