// ---------- LA GRILLE DES RÉSIDENTS (src/pages/residents/index.astro) ----------
// La page arrive déjà filtrée d'après son adresse. Ici, sans recharger : RÉSIDENTS / INVITÉS et l'activité filtrent
// sur place (le même calcul que le serveur, src/lib/residents.ts), l'adresse suit sans s'empiler dans l'historique, et le
// nombre de portraits est annoncé aux lecteurs d'écran. L'index A–Z mène au premier portrait d'une lettre et allume
// celle qu'on parcourt ; au clavier, il ne coûte qu'une touche Tab (↑ ↓ ou ← → pour y circuler). Les pastilles « À
// l'antenne » s'allument d'après les diffusions de la journée, à la minute. Branché sur astro:page-load : à chaque
// arrivée sur la page.
import type { ArtistRole } from "@parabole/cms";
import { adresseDe, correspond, lireEtat, type EtatGrille } from "../lib/residents";

const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ancre = (lettre: string) => `lettre-${lettre === "#" ? "0" : lettre}`;
const nommer = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;
let antenne: ReturnType<typeof setInterval> | undefined;

document.addEventListener("astro:page-load", () => {
  clearInterval(antenne);
  const racine = document.querySelector<HTMLElement>("[data-residents]");
  if (!racine) return;
  allumerLAntenne(racine);
  const regie = racine.querySelector<HTMLElement>(".regie");
  if (!regie) return; // pas d'artiste, ou la base ne répond pas : rien à filtrer

  const page = document.getElementById("page");
  const index = racine.querySelector<HTMLElement>(".index-az");
  const lettres = [...racine.querySelectorAll<HTMLAnchorElement>(".index-az a")];
  const cartes = [...racine.querySelectorAll<HTMLLIElement>(".grille > li")].map((li) => ({
    li,
    slug: li.dataset.slug!,
    lettre: li.dataset.lettre!,
    nom: li.dataset.nom!,
    etiquettes: (li.dataset.etiquettes || "").split(" ").filter(Boolean),
    role: li.closest<HTMLElement>("[data-liste]")!.dataset.liste as ArtistRole,
  }));
  const puces = [...racine.querySelectorAll<HTMLAnchorElement>(".regie-puce")];
  const couvre = (activite: string) => (puces.find((p) => p.dataset.activite === activite)?.dataset.couvre || "").split(" ").filter(Boolean);
  const etat: EtatGrille = lireEtat(new URLSearchParams(location.search));
  if (!puces.some((p) => p.dataset.activite === etat.activite)) etat.activite = "";

  /** Tout ce qui dépend de l'état : les portraits, les listes, les repères, l'index, la rangée du haut. */
  function appliquer(annoncer: boolean) {
    const filtre = couvre(etat.activite);
    let vues = 0;
    for (const carte of cartes) {
      const oui = correspond(carte, etat, filtre);
      carte.li.hidden = !oui;
      if (oui) vues++;
    }
    racine!.toggleAttribute("data-recherche", !!etat.q);
    // les listes : celle du rôle choisi ; avec une recherche, celles qui ont des réponses, chacune sous son titre
    for (const liste of racine!.querySelectorAll<HTMLElement>("[data-liste]"))
      liste.hidden = etat.q ? !cartes.some((c) => c.role === liste.dataset.liste && !c.li.hidden) : liste.dataset.liste !== etat.role;
    // le premier portrait visible de chaque lettre porte sa lettre ; dans la liste parcourue, il est l'ancre de l'index
    const presentes = new Set<string>();
    let avant = "",
      roleAvant = "";
    for (const carte of cartes) {
      carte.li.removeAttribute("id");
      if (carte.li.hidden) {
        carte.li.removeAttribute("data-repere");
        continue;
      }
      const repere = carte.lettre !== avant || carte.role !== roleAvant;
      carte.li.toggleAttribute("data-repere", repere);
      if (repere && !etat.q && carte.role === etat.role) {
        carte.li.id = ancre(carte.lettre);
        presentes.add(carte.lettre);
      }
      avant = carte.lettre;
      roleAvant = carte.role;
    }
    if (index) index.hidden = !!etat.q;
    let premiere = true;
    for (const a of lettres) {
      const oui = presentes.has(a.dataset.lettre!);
      if (oui) a.removeAttribute("aria-disabled");
      else a.setAttribute("aria-disabled", "true");
      a.tabIndex = oui && premiere ? 0 : -1;
      if (oui) premiere = false;
    }
    // la rangée du haut
    for (const touche of regie!.querySelectorAll<HTMLAnchorElement>(".regie-touche[data-role]")) {
      if (!etat.q && touche.dataset.role === etat.role) touche.setAttribute("aria-current", "true");
      else touche.removeAttribute("aria-current");
      touche.href = adresseDe({ role: touche.dataset.role as ArtistRole, activite: "", q: "" });
    }
    const activitesNav = regie!.querySelector<HTMLElement>(".regie-activites");
    if (activitesNav) activitesNav.hidden = !!etat.q;
    for (const puce of puces) {
      const activite = puce.dataset.activite!;
      if (activite === etat.activite) puce.setAttribute("aria-current", "true");
      else puce.removeAttribute("aria-current");
      puce.href = adresseDe({ ...etat, q: "", activite });
      if (!activite) continue;
      const n = cartes.filter((c) => c.role === etat.role && c.etiquettes.some((e) => couvre(activite).includes(e))).length;
      const nombre = puce.querySelector(".regie-nombre");
      if (nombre) nombre.textContent = String(n);
      if (n) {
        puce.removeAttribute("aria-disabled");
        puce.removeAttribute("tabindex");
      } else {
        puce.setAttribute("aria-disabled", "true");
        puce.tabIndex = -1;
      }
    }
    const recherche = regie!.querySelector<HTMLElement>(".regie-recherche");
    if (recherche) {
      recherche.hidden = !etat.q;
      const mot = recherche.querySelector("[data-recherche-mot]");
      if (mot) mot.textContent = etat.q;
    }
    const aucun = racine!.querySelector<HTMLElement>(".residents-aucun");
    if (aucun) {
      aucun.hidden = vues > 0;
      const texte = aucun.querySelector("[data-aucun-texte]");
      if (texte)
        texte.textContent = etat.q
          ? `Personne ne répond à « ${etat.q} » parmi les résidents et les invités.`
          : `Pas encore ${etat.role === "guest" ? "d'invité" : "de résident"} dans cette activité.`;
    }
    if (annoncer) {
      const annonce = racine!.querySelector("[data-annonce]");
      if (annonce)
        annonce.textContent = etat.q
          ? nommer(vues, `artiste pour « ${etat.q} »`, `artistes pour « ${etat.q} »`)
          : nommer(vues, etat.role === "guest" ? "invité" : "résident", etat.role === "guest" ? "invités" : "résidents");
    }
    suivreLaLettre();
  }

  /** Un nouvel état, choisi dans la rangée : la grille, l'adresse (sans empiler), et le haut de la grille. */
  function choisir(nouvel: Partial<EtatGrille>) {
    Object.assign(etat, nouvel);
    appliquer(true);
    history.replaceState(history.state, "", adresseDe(etat));
    page?.scrollTo({ top: 0 });
  }

  regie.addEventListener("click", (e) => {
    const lien = (e.target as Element).closest<HTMLAnchorElement>("a");
    if (!lien || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (lien.getAttribute("aria-disabled") === "true") return void e.preventDefault();
    if (lien.dataset.role) {
      e.preventDefault();
      const role = lien.dataset.role as ArtistRole;
      // l'activité reste, si l'autre rôle en a
      const garde = etat.activite && cartes.some((c) => c.role === role && c.etiquettes.some((x) => couvre(etat.activite).includes(x)));
      choisir({ role, q: "", activite: garde ? etat.activite : "" });
    } else if (lien.dataset.activite !== undefined) {
      e.preventDefault();
      choisir({ activite: lien.dataset.activite, q: "" });
    } else if ("effacer" in lien.dataset) {
      e.preventDefault();
      choisir({ q: "", activite: "" });
    }
  });
  racine.querySelector("[data-tout-revoir]")?.addEventListener("click", (e) => {
    e.preventDefault();
    choisir({ q: "", activite: "" });
  });

  // L'index : une lettre mène à son premier portrait, et lui donne le focus
  function allerA(lettre: string) {
    const cible = document.getElementById(ancre(lettre));
    if (!cible) return;
    cible.scrollIntoView({ block: "start", behavior: calme() ? "auto" : "smooth" });
    cible.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  }
  index?.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[data-lettre]");
    if (!a) return;
    e.preventDefault();
    if (a.getAttribute("aria-disabled") !== "true") allerA(a.dataset.lettre!);
  });
  // ... et au clavier, une seule touche Tab : on circule entre les lettres présentes avec les flèches
  index?.addEventListener("keydown", (e) => {
    const presentes = lettres.filter((a) => a.getAttribute("aria-disabled") !== "true");
    const i = presentes.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const pas = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const cible = pas ? presentes[Math.min(Math.max(i + pas, 0), presentes.length - 1)] : e.key === "Home" ? presentes[0] : e.key === "End" ? presentes.at(-1) : null;
    if (!cible) return;
    e.preventDefault();
    presentes.forEach((a) => (a.tabIndex = a === cible ? 0 : -1));
    cible.focus();
  });

  // La lettre qu'on parcourt s'allume dans l'index
  let attente = 0;
  function suivreLaLettre() {
    if (!index || index.hidden) return;
    const haut = regie!.getBoundingClientRect().bottom;
    const premiere = cartes.find((c) => !c.li.hidden && c.role === etat.role && c.li.getBoundingClientRect().bottom > haut + 8);
    for (const a of lettres) {
      if (premiere && a.dataset.lettre === premiere.lettre) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
  }
  page?.addEventListener(
    "scroll",
    () => {
      cancelAnimationFrame(attente);
      attente = requestAnimationFrame(suivreLaLettre);
    },
    { passive: true },
  );

  appliquer(false);
});

/** Les pastilles « À l'antenne » : un portrait s'allume pendant une diffusion de son artiste ; vérifié à la minute. */
function allumerLAntenne(racine: HTMLElement) {
  let diffusions: { debut: string; fin: string; artistes: string[] }[] = [];
  try {
    diffusions = JSON.parse(racine.dataset.diffusions || "[]");
  } catch (e) {
    return;
  }
  const pastilles = [...racine.querySelectorAll<HTMLLIElement>(".grille > li")].map((li) => ({ slug: li.dataset.slug!, pastille: li.querySelector<HTMLElement>(".portrait-antenne") }));
  if (!pastilles.length) return;
  const verifier = () => {
    const maintenant = Date.now();
    const aLAntenne = new Set(
      diffusions.filter((d) => Date.parse(d.debut) <= maintenant && maintenant < Date.parse(d.fin)).flatMap((d) => d.artistes),
    );
    for (const { slug, pastille } of pastilles) if (pastille) pastille.hidden = !aLAntenne.has(slug);
  };
  verifier();
  antenne = setInterval(verifier, 30_000);
}
