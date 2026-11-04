// ---------- LES ÉMISSIONS (src/pages/emissions/) ----------
// La liste arrive déjà filtrée d'après son adresse, avec toutes les archives. Ici, sans recharger : les onglets, les
// pastilles des panneaux TRIER PAR, celles des filtres en service et TOUT EFFACER filtrent sur place (le même calcul que
// le serveur, src/lib/emissions.ts). Le panneau ouvert ne bouge pas : un groupe choisi déplie ses étiquettes juste
// dessous, chaque pastille dit combien d'émissions elle donnerait avec les autres filtres, et celles qui ne donneraient
// rien s'éteignent. L'adresse suit sans s'empiler dans l'historique ; le nombre d'émissions est annoncé aux lecteurs
// d'écran. Rien ne change de place : les touches et les mois qui ne donnent rien s'éteignent, le panneau se pose
// par-dessus la grille. Le rail allume le mois qu'on parcourt.
// La page d'une émission : AUTRES ÉMISSIONS défile avec ◂ ▸ (rangees.ts), et « ◂ ÉMISSIONS » revient en arrière quand
// on arrive de la liste, pour la retrouver au même endroit, filtres compris. La lecture, elle, est dans la ligne ARCHIVE
// (archive.ts). Branché sur astro:page-load : à chaque arrivée sur l'une de ces pages.
import type { ShowType } from "@parabole/cms";
import {
  adresseDe,
  ancreDuMois,
  avecMood,
  cleDe,
  compter,
  correspond,
  facettesDuType,
  libelleMois,
  lireEtat,
  moisEnClair,
  MOOD,
  ONGLETS,
  type Couvertures,
  type EtatListe,
  type Facette,
} from "../lib/emissions";
import { brancherLesRangees } from "./rangees";
import { PAGE_AVANT } from "./router";

const nommer = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
/** Éteindre une touche sans la retirer : elle reste à sa place, mais ne se choisit plus, ni à la souris, ni au clavier. */
function eteindre(element: HTMLElement, oui: boolean) {
  if (oui) {
    element.setAttribute("aria-disabled", "true");
    element.tabIndex = -1;
  } else {
    element.removeAttribute("aria-disabled");
    element.removeAttribute("tabindex");
  }
}
let fin: AbortController | null = null;

document.addEventListener("astro:page-load", () => {
  fin?.abort();
  fin = new AbortController();
  const { signal } = fin;
  const liste = document.querySelector<HTMLElement>("[data-emissions]");
  if (liste) brancherLaListe(liste, signal);
  const emission = document.querySelector<HTMLElement>("[data-emission]");
  if (emission) brancherLEmission(emission);
});

function brancherLaListe(racine: HTMLElement, signal: AbortSignal) {
  const corps = racine.querySelector<HTMLElement>(".emissions-corps");
  const regie = racine.querySelector<HTMLElement>(".regie");
  if (!corps || !regie) return; // pas d'archive, ou la base ne répond pas : rien à filtrer

  const page = document.getElementById("page");
  const onglets = [...regie.querySelectorAll<HTMLAnchorElement>(".regie-roles a[data-type]")];
  const touches = [...regie.querySelectorAll<HTMLAnchorElement>(".trier-touche[data-trier]")];
  const panneaux = [...racine.querySelectorAll<HTMLElement>(".panneau-trier")];
  const puces = [...racine.querySelectorAll<HTMLAnchorElement>(".panneau-puce[data-facette]")];
  const groupes = [...racine.querySelectorAll<HTMLElement>(".panneau-groupe")];
  const rail = racine.querySelector<HTMLElement>(".rail-mois ol");
  const liens = new Map([...racine.querySelectorAll<HTMLAnchorElement>(".rail-mois a[data-mois]")].map((lien) => [lien.dataset.mois!, lien]));
  const actifs = regie.querySelector<HTMLElement>("[data-actifs]");
  const pastilles = regie.querySelector<HTMLElement>("[data-pastilles]");
  const total = regie.querySelector<HTMLElement>("[data-total]");
  const aucun = racine.querySelector<HTMLElement>("[data-aucun]");
  const annonce = racine.querySelector<HTMLElement>("[data-annonce]");

  // Les filtres de l'admin (chacun dit les types qu'il range), ce que couvre chaque choix, et les émissions
  const facettes: (Facette & { nom: string })[] = touches
    .filter((touche) => touche.dataset.trier !== MOOD)
    .map((touche) => ({ slug: touche.dataset.trier!, nom: touche.textContent!.trim(), showTypes: (touche.dataset.types || "").split(" ").filter(Boolean) as ShowType[] }));
  const couvertures: Couvertures = new Map();
  for (const puce of puces) if (puce.dataset.couvre) couvertures.set(cleDe(puce.dataset.facette!, puce.dataset.etiquette!), puce.dataset.couvre.split(" "));
  const cartes = [...racine.querySelectorAll<HTMLLIElement>(".grille-emissions > li")].map((li) => ({
    li,
    type: li.dataset.type as ShowType,
    etiquettes: (li.dataset.etiquettes || "").split(" ").filter(Boolean),
    mood: li.dataset.mood ? Number(li.dataset.mood) : null,
    mois: li.dataset.mois!,
  }));
  const etat: EtatListe = lireEtat(new URLSearchParams(location.search), facettes);
  for (const [facette, slug] of Object.entries(etat.filtres)) if (!couvertures.has(cleDe(facette, slug))) delete etat.filtres[facette];

  const sans = (facette: string) => {
    const { [facette]: _retire, ...autres } = etat.filtres;
    return autres;
  };
  const nomDe = (facette: string, slug: string) =>
    puces.find((puce) => puce.dataset.facette === facette && puce.dataset.etiquette === slug)?.dataset.nom ?? (facette === MOOD ? `Mood ${slug}` : slug);
  /** L'adresse d'un choix dans un filtre : choisir l'étiquette, ou la retirer si c'est déjà elle. */
  const adresseDuChoix = (facette: string, slug: string) =>
    facette === MOOD
      ? adresseDe({ ...etat, mood: !slug || etat.mood === Number(slug) ? null : Number(slug), trier: MOOD })
      : adresseDe({ ...etat, filtres: !slug || etat.filtres[facette] === slug ? sans(facette) : { ...sans(facette), [facette]: slug }, trier: facette });

  /** Tout ce qui dépend de l'état : la grille, ses repères, le rail, les onglets, TRIER PAR, les panneaux, les pastilles. */
  function appliquer(annoncer: boolean) {
    const valables = new Set(facettesDuType(etat.type, facettes).map((facette) => facette.slug));
    if (avecMood(etat.type)) valables.add(MOOD);
    if (etat.trier && !valables.has(etat.trier)) etat.trier = "";

    // la grille, et le premier show visible de chaque mois, qui porte le mois et son ancre
    const parMois = new Map<string, number>();
    let vues = 0;
    let avant = "";
    for (const carte of cartes) {
      const oui = correspond(carte, etat, couvertures);
      carte.li.hidden = !oui;
      const repere = oui && carte.mois !== avant;
      carte.li.toggleAttribute("data-repere", repere);
      if (repere) {
        carte.li.dataset.repere = libelleMois(carte.mois);
        carte.li.id = ancreDuMois(carte.mois);
      } else carte.li.removeAttribute("id");
      if (!oui) continue;
      vues++;
      avant = carte.mois;
      parMois.set(carte.mois, (parMois.get(carte.mois) ?? 0) + 1);
    }
    // le rail garde tous ses mois, en place : ceux qui n'ont rien dans la grille s'éteignent
    for (const [mois, lien] of liens) {
      const n = parMois.get(mois) ?? 0;
      eteindre(lien, !n);
      const quoi = `${moisEnClair(mois)}, ${nommer(n, "émission", "émissions")}`;
      lien.setAttribute("aria-label", quoi);
      lien.title = quoi.replace(", ", " · ");
    }
    // les onglets
    for (const onglet of onglets) {
      const type = ONGLETS.find((o) => o.cle === onglet.dataset.type)?.type ?? null;
      if (type === etat.type) onglet.setAttribute("aria-current", "true");
      else onglet.removeAttribute("aria-current");
    }
    // TRIER PAR : ses touches restent en place ; celles des filtres d'un autre type s'éteignent
    for (const touche of touches) {
      const cle = touche.dataset.trier!;
      eteindre(touche, !valables.has(cle));
      touche.setAttribute("aria-expanded", String(etat.trier === cle));
      touche.toggleAttribute("data-filtre", cle === MOOD ? !!etat.mood : !!etat.filtres[cle]);
      touche.href = adresseDe({ ...etat, trier: etat.trier === cle ? "" : cle });
    }
    corps!.toggleAttribute("data-trier", !!etat.trier);
    if (etat.trier) corps!.dataset.trier = etat.trier;
    for (const panneau of panneaux) panneau.hidden = panneau.dataset.facette !== etat.trier;
    // les pastilles des panneaux : la choisie allumée, chacune avec son nombre, celles qui ne donneraient rien éteintes
    for (const puce of puces) {
      const facette = puce.dataset.facette!;
      const slug = puce.dataset.etiquette!;
      const choisi = facette === MOOD ? (etat.mood ? String(etat.mood) : "") : (etat.filtres[facette] ?? "");
      const n = compter(cartes, etat, couvertures, facette, slug);
      if (choisi === slug) puce.setAttribute("aria-current", "true");
      else puce.removeAttribute("aria-current");
      eteindre(puce, !n && !!slug && choisi !== slug);
      const nombre = puce.querySelector(".regie-nombre");
      if (nombre) nombre.textContent = String(n);
      puce.href = adresseDuChoix(facette, slug);
    }
    // un groupe choisi, ou dont une étiquette est choisie, montre ses étiquettes
    for (const groupe of groupes) {
      const facette = groupe.closest<HTMLElement>(".panneau-trier")!.dataset.facette!;
      const choisi = etat.filtres[facette];
      const ouvert = !!choisi && (choisi === groupe.dataset.groupe || !!groupe.querySelector(`[data-etiquette="${CSS.escape(choisi)}"]`));
      groupe.toggleAttribute("data-ouvert", ouvert);
      const sous = groupe.querySelector<HTMLElement>(".panneau-etiquettes");
      if (sous) sous.hidden = !ouvert;
      groupe.querySelector(".panneau-puce-groupe")?.setAttribute("aria-expanded", String(ouvert));
    }
    // les filtres en service, le nombre d'émissions, TOUT EFFACER
    const choisis = [
      ...Object.entries(etat.filtres).map(([facette, slug]) => ({ facette, quoi: facettes.find((f) => f.slug === facette)?.nom ?? facette, mot: nomDe(facette, slug) })),
      ...(etat.mood ? [{ facette: MOOD, quoi: "Mood", mot: `Mood ${etat.mood}` }] : []),
    ];
    if (total) total.textContent = nommer(vues, "émission", "émissions");
    pastilles?.replaceChildren(
      ...choisis.map(({ facette, quoi, mot }) => {
        const li = document.createElement("li");
        const lien = document.createElement("a");
        lien.className = "regie-puce";
        lien.dataset.retirer = facette;
        lien.href = facette === MOOD ? adresseDe({ ...etat, mood: null }) : adresseDe({ ...etat, filtres: sans(facette) });
        lien.setAttribute("aria-label", `Retirer le filtre ${quoi} : ${mot}`);
        const croix = document.createElement("span");
        croix.className = "trier-retirer";
        croix.setAttribute("aria-hidden", "true");
        croix.textContent = "×";
        lien.append(mot, croix);
        li.append(lien);
        return li;
      }),
    );
    for (const effacer of racine.querySelectorAll<HTMLAnchorElement>("[data-effacer]")) effacer.href = adresseDe({ ...etat, filtres: {}, mood: null });
    const effacerTout = actifs?.querySelector<HTMLElement>("[data-effacer]");
    if (effacerTout) effacerTout.hidden = !choisis.length;
    if (aucun) aucun.hidden = vues > 0;
    if (annoncer && annonce) annonce.textContent = choisis.length ? nommer(vues, "émission trouvée", "émissions trouvées") : nommer(vues, "émission", "émissions");
    suivre();
  }

  /**
   * Un nouvel état : la grille, l'adresse (sans empiler). Rien d'autre ne bouge ; seulement, si l'on était descendu
   * dans la grille, on revient à son début, pour voir ce que donnent les filtres.
   */
  function choisir(changer: () => void, remonter: boolean) {
    changer();
    appliquer(true);
    history.replaceState(history.state, "", adresseDe(etat) + (location.hash && !remonter ? location.hash : ""));
    if (!remonter || !page) return;
    const debut = corps!.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - regie!.offsetHeight;
    if (page.scrollTop > debut) page.scrollTo({ top: Math.max(0, debut) });
  }

  function choisirType(type: ShowType | null) {
    etat.type = type;
    // les filtres qui valent encore pour ce type restent
    const valables = facettesDuType(type, facettes).map((facette) => facette.slug);
    for (const facette of Object.keys(etat.filtres)) if (!valables.includes(facette)) delete etat.filtres[facette];
    if (!avecMood(type)) etat.mood = null;
  }

  regie.addEventListener(
    "click",
    (e) => {
      const lien = (e.target as Element).closest<HTMLAnchorElement>("a");
      if (!lien || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (lien.dataset.type !== undefined) {
        e.preventDefault();
        choisir(() => choisirType(ONGLETS.find((o) => o.cle === lien.dataset.type)?.type ?? null), true);
      } else if (lien.dataset.trier) {
        // un panneau à la fois, ouvert ou fermé sur place ; une touche éteinte (un autre type) ne fait rien
        e.preventDefault();
        if (lien.getAttribute("aria-disabled") === "true") return;
        const cle = lien.dataset.trier;
        choisir(() => (etat.trier = etat.trier === cle ? "" : cle), false);
        if (etat.trier) racine.querySelector<HTMLElement>(`#panneau-${cle} .panneau-puce:not([aria-disabled])`)?.focus({ preventScroll: true });
      } else if (lien.dataset.retirer) {
        e.preventDefault();
        const facette = lien.dataset.retirer;
        choisir(() => (facette === MOOD ? (etat.mood = null) : delete etat.filtres[facette]), true);
      } else if ("effacer" in lien.dataset) {
        e.preventDefault();
        choisir(() => ((etat.filtres = {}), (etat.mood = null)), true);
      }
    },
    { signal },
  );

  corps.addEventListener(
    "click",
    (e) => {
      const lien = (e.target as Element).closest<HTMLAnchorElement>("a");
      if (!lien || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if ("fermer" in lien.dataset) {
        e.preventDefault();
        const cle = etat.trier;
        choisir(() => (etat.trier = ""), false);
        touches.find((touche) => touche.dataset.trier === cle)?.focus({ preventScroll: true });
      } else if ("effacer" in lien.dataset) {
        e.preventDefault();
        choisir(() => ((etat.filtres = {}), (etat.mood = null)), true);
      } else if (lien.dataset.facette) {
        e.preventDefault();
        if (lien.getAttribute("aria-disabled") === "true") return;
        const facette = lien.dataset.facette;
        const slug = lien.dataset.etiquette ?? "";
        choisir(() => {
          if (facette === MOOD) etat.mood = !slug || etat.mood === Number(slug) ? null : Number(slug);
          else if (!slug) delete etat.filtres[facette];
          // une étiquette déjà choisie : retour à son groupe ; un groupe déjà choisi : plus de filtre
          else if (etat.filtres[facette] === slug) {
            if (lien.dataset.groupe) etat.filtres[facette] = lien.dataset.groupe;
            else delete etat.filtres[facette];
          } else etat.filtres[facette] = slug;
        }, true);
      }
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !etat.trier || (e.target as Element | null)?.closest?.("input, textarea, .teletexte:not(.panneau-trier)")) return;
      const cle = etat.trier;
      choisir(() => (etat.trier = ""), false);
      touches.find((touche) => touche.dataset.trier === cle)?.focus({ preventScroll: true });
    },
    { signal },
  );

  // ---------- Le rail : le mois qu'on parcourt est allumé ----------
  let allume = rail?.querySelector<HTMLAnchorElement>('a[aria-current="location"]') ?? null;
  let prevu = 0;
  // le mois choisi sur le rail (ici, ou dans une adresse : #mois-2025-12) reste allumé jusqu'à ce qu'on fasse défiler
  // soi-même : il peut commencer au milieu d'une rangée, derrière la fin du mois d'avant
  let voulu = /^#mois-\d{4}-\d{2}$/.test(location.hash) ? location.hash.slice(6) : "";
  rail?.addEventListener("click", (e) => (voulu = (e.target as Element).closest<HTMLAnchorElement>("a[data-mois]")?.dataset.mois ?? voulu), { signal });
  for (const geste of ["wheel", "touchstart", "keydown"] as const) document.addEventListener(geste, () => (voulu = ""), { passive: true, signal });
  function suivre() {
    prevu = 0;
    if (!page || !rail) return;
    // le mois de la première carte qu'on voit encore, sous la rangée du haut (deux mois peuvent commencer sur la même
    // rangée de la grille : c'est le premier, à gauche, qu'on parcourt)
    const haut = page.getBoundingClientRect().top + regie!.offsetHeight + 40;
    const visibles = cartes.filter((carte) => !carte.li.hidden);
    const carte = visibles.find((c) => c.li.getBoundingClientRect().bottom > haut) ?? visibles[visibles.length - 1];
    const lien = liens.get(voulu && !liens.get(voulu)?.hasAttribute("aria-disabled") ? voulu : (carte?.mois ?? "")) ?? null;
    if (lien === allume) return;
    allume?.removeAttribute("aria-current");
    lien?.setAttribute("aria-current", "location");
    allume = lien;
    // le mois allumé reste en vue dans le rail, s'il est plus long que l'écran (sans faire défiler la page)
    if (lien && rail.scrollHeight > rail.clientHeight) {
      const { offsetTop, offsetHeight } = lien;
      if (offsetTop < rail.scrollTop) rail.scrollTop = offsetTop;
      else if (offsetTop + offsetHeight > rail.scrollTop + rail.clientHeight) rail.scrollTop = offsetTop + offsetHeight - rail.clientHeight;
    }
  }
  page?.addEventListener("scroll", () => (prevu ||= requestAnimationFrame(suivre)), { passive: true, signal });

  appliquer(false);
}

function brancherLEmission(racine: HTMLElement) {
  brancherLesRangees(racine);
  // ◂ ÉMISSIONS : arrivé de la liste, on y revient en arrière, à la même place et avec les mêmes filtres
  racine.querySelector<HTMLAnchorElement>("[data-retour]")?.addEventListener("click", (e) => {
    let avant = "";
    try {
      avant = sessionStorage.getItem(PAGE_AVANT) || "";
    } catch {
      /* pas de mémoire : le lien suffit */
    }
    if (/^\/emissions\/?(\?|$)/.test(avant) && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      history.back();
    }
  });
}
