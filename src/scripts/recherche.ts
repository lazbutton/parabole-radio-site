// ---------- LA LOUPE : chercher dans tout le site, réponse en page de télétexte ----------
// Le champ de l'en-tête (TopBar.astro) interroge /api/recherche dès deux lettres, 150 ms après la dernière frappe, une
// requête à la fois (la précédente est abandonnée). La réponse s'affiche dans la page P101, sous la ligne ON AIR : les
// artistes, qui mènent à leur page, puis les émissions et les événements, sans lien tant que leurs rubriques n'existent
// pas. Pendant la recherche, le numéro de la page défile, comme un décodeur qui cherche sa page. Au clavier : « / » met le
// curseur dans la loupe depuis n'importe où, ↓ passe aux résultats et ↑ ↓ y circulent, Entrée ouvre le premier artiste,
// Échap ferme la page puis vide le champ. Sur téléphone, la touche loupe ouvre le champ sur toute la ligne.
import type { ResultatsRecherche } from "../lib/recherche";
import { STATION_TIMEZONE } from "./settings";
import { mettreALHeure } from "./teletexte";
import { escapeHtml, fetchJson } from "./util";

const tete = document.querySelector<HTMLElement>(".tete");
const form = document.getElementById("loupe") as HTMLFormElement | null;
const champ = document.getElementById("loupeChamp") as HTMLInputElement | null;
const page = document.getElementById("loupePage");
const resultats = document.getElementById("loupeResultats");
const numero = document.getElementById("loupeNumero");
const titre = document.getElementById("loupeTitre");
const annonce = document.getElementById("loupeAnnonce");
const deplierBouton = document.getElementById("loupeOuvrir");
const replierBouton = document.getElementById("loupeFermer");

/** Les artistes montrés ; au-delà, « voir les N artistes » mène à la grille des résidents. */
const VISIBLES = 5;
const jour = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, day: "numeric", month: "short", year: "numeric" });
const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const telephone = () => !!window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
/** Au moins deux lettres ou chiffres : en dessous, trop vague pour chercher (comme le CMS). */
const utile = (q: string) => q.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

if (tete && form && champ && page && resultats && numero && titre && annonce) {
  const dateDe = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? jour.format(d) : "";
  };
  const ligne = (nom: string, quoi: string[]) => {
    const details = quoi.filter(Boolean).join(" · ");
    return `<span class="loupe-nom">${escapeHtml(nom)}</span>${details ? `<span class="loupe-quoi">${escapeHtml(details)}</span>` : ""}`;
  };

  function rendre(r: ResultatsRecherche) {
    const lignes: string[] = [];
    if (r.artists.length) {
      lignes.push(`<p class="loupe-groupe">Artistes</p>`);
      for (const a of r.artists.slice(0, VISIBLES))
        lignes.push(`<a class="loupe-ligne" href="/residents/${encodeURIComponent(a.slug)}">${ligne(a.name, a.tags)}</a>`);
      if (r.artists.length > VISIBLES || r.moreArtists) {
        const combien = r.moreArtists ? "tous les artistes" : `les ${r.artists.length} artistes`;
        lignes.push(`<a class="loupe-ligne loupe-tous" href="/residents?q=${encodeURIComponent(r.query)}">Voir ${combien}</a>`);
      }
    }
    if (r.shows.length) {
      lignes.push(`<p class="loupe-groupe">Émissions</p>`);
      for (const s of r.shows) lignes.push(`<p class="loupe-ligne">${ligne(s.title, [dateDe(s.broadcastAt), s.type])}</p>`);
    }
    if (r.events.length) {
      lignes.push(`<p class="loupe-groupe">Événements</p>`);
      for (const e of r.events) lignes.push(`<p class="loupe-ligne">${ligne(e.title, [dateDe(e.startsAt), e.venue ?? ""])}</p>`);
    }
    if (!lignes.length) lignes.push(`<p class="loupe-message">Aucune page ne répond à « ${escapeHtml(r.query)} ».</p>`);
    resultats!.innerHTML = lignes.join("");
    resultats!.scrollTop = 0;
    titre!.textContent = `Recherche « ${r.query} »`;
    const total = r.artists.length + r.shows.length + r.events.length;
    annonce!.textContent = total
      ? `${pluriel(r.artists.length, "artiste")}, ${pluriel(r.shows.length, "émission")}, ${pluriel(r.events.length, "événement")}`
      : "Aucun résultat";
  }

  // Le décodeur qui cherche sa page : le numéro défile tant que la réponse n'est pas là
  let decodeur: ReturnType<typeof setInterval> | undefined;
  function chercheSaPage() {
    clearInterval(decodeur);
    if (calme()) return;
    let n = 101;
    decodeur = setInterval(() => {
      n = n >= 199 ? 101 : n + 1;
      numero!.textContent = "P" + n;
    }, 60);
  }
  function pageTrouvee() {
    clearInterval(decodeur);
    numero!.textContent = "P101";
  }

  function ouvrirPage() {
    if (!page!.hidden) return;
    page!.hidden = false;
    champ!.setAttribute("aria-expanded", "true");
    mettreALHeure();
  }
  function fermerPage() {
    if (page!.hidden) return;
    page!.hidden = true;
    champ!.setAttribute("aria-expanded", "false");
    pageTrouvee();
  }

  const deja = new Map<string, ResultatsRecherche>();
  let enCours: AbortController | null = null;
  let attente: ReturnType<typeof setTimeout> | undefined;

  async function chercher(q: string) {
    enCours?.abort();
    const ici = (enCours = new AbortController());
    try {
      const r = await fetchJson<ResultatsRecherche>(`/api/recherche?q=${encodeURIComponent(q)}`, { signal: ici.signal });
      deja.set(q.toLowerCase(), r);
      if (ici.signal.aborted || champ!.value.trim() !== q) return;
      pageTrouvee();
      rendre(r);
    } catch (e) {
      if (ici.signal.aborted) return;
      pageTrouvee();
      resultats!.innerHTML = `<p class="loupe-message erreur">Interruption momentanée : la recherche revient dans un instant.</p>`;
      annonce!.textContent = "Recherche indisponible pour le moment";
    }
  }

  champ.addEventListener("input", () => {
    const q = champ.value.trim();
    clearTimeout(attente);
    if (!utile(q)) {
      enCours?.abort();
      fermerPage();
      return;
    }
    ouvrirPage();
    const connue = deja.get(q.toLowerCase());
    if (connue) {
      enCours?.abort();
      pageTrouvee();
      rendre(connue);
      return;
    }
    titre.textContent = `Recherche « ${q} »`;
    if (!resultats.firstChild) resultats.innerHTML = `<p class="loupe-message">Recherche en cours…</p>`;
    chercheSaPage();
    attente = setTimeout(() => chercher(q), 150);
  });
  // la page refermée (Échap, un clic ailleurs) se rouvre d'un clic dans le champ, ou avec ↓
  const rouvrir = () => {
    if (utile(champ.value.trim()) && resultats.firstChild) ouvrirPage();
  };
  champ.addEventListener("click", rouvrir);

  // Entrée : le premier artiste trouvé (les émissions et les événements n'ont pas encore de page)
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (page.hidden) return;
    resultats.querySelector<HTMLAnchorElement>("a.loupe-ligne:not(.loupe-tous)")?.click();
  });

  // ↓ ↑ entre le champ et les résultats ; Échap ferme la page, puis vide le champ, puis replie la loupe du téléphone
  form.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && page.hidden && document.activeElement === champ) {
      rouvrir();
      if (!page.hidden) e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const liens = [...resultats.querySelectorAll<HTMLAnchorElement>("a.loupe-ligne")];
      if (page.hidden || !liens.length) return;
      e.preventDefault();
      const i = liens.indexOf(document.activeElement as HTMLAnchorElement);
      if (e.key === "ArrowDown") liens[i < 0 ? 0 : Math.min(i + 1, liens.length - 1)].focus();
      else if (i <= 0) champ.focus();
      else liens[i - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!page.hidden) {
        fermerPage();
        champ.focus();
      } else if (champ.value) {
        champ.value = "";
        enCours?.abort();
      } else if (tete.classList.contains("loupe-ouverte")) {
        replier();
        deplierBouton?.focus();
      }
    }
  });

  // Sur téléphone, la loupe repliée en une touche s'ouvre sur toute la ligne
  function deplier() {
    tete!.classList.add("loupe-ouverte");
    deplierBouton?.setAttribute("aria-expanded", "true");
    champ!.focus();
  }
  function replier() {
    tete!.classList.remove("loupe-ouverte");
    deplierBouton?.setAttribute("aria-expanded", "false");
    fermerPage();
  }
  deplierBouton?.addEventListener("click", deplier);
  replierBouton?.addEventListener("click", () => {
    replier();
    deplierBouton?.focus();
  });

  // « / » depuis n'importe où, sauf en écrivant ailleurs
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    if (telephone()) deplier();
    else champ.focus();
  });
  // un clic ailleurs ferme la page ; un changement de page remet la loupe à zéro
  document.addEventListener("pointerdown", (e) => {
    if (!page.hidden && !form.contains(e.target as Node)) fermerPage();
  });
  document.addEventListener("astro:before-preparation", () => {
    enCours?.abort();
    clearTimeout(attente);
    replier();
    champ.value = "";
    champ.blur();
  });
}
