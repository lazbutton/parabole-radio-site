// ---------- LE DIRECT (ce qui passe, NOWPLAYING_URL dans settings.ts) ----------
// Lit {title, artist, show, source, elapsed, received_at, previous, next_autodj} toutes les 10 s, ou le reçoit en temps
// réel quand la station le pousse, pour la ligne ON AIR de l'en-tête (ce qui passe, qui défile ; sur l'accueil, les
// phrases de Parabole), l'affichage de l'accueil et HISTORIQUE.
import { subscribe } from "../lib/station";
import type { NowPlaying, Track } from "../lib/station/types";
import { radioControl } from "./audio";
import { historyOpen, loadHistory } from "./history";
import { askHopper, fillLogos } from "./hopper";
import { NOWPLAYING_URL, PHRASES_ACCUEIL } from "./settings";
import { station, type Play } from "./state";
import { escapeHtml, fetchJson } from "./util";

// ---------- LA LIGNE ON AIR : ce qui passe, qui défile en continu, comme le bandeau d'une chaîne d'info ----------
// Un passage du texte (les morceaux, chacun suivi d'un carré jaune) est répété autant qu'il faut pour couvrir la ligne :
// c'est une moitié de la piste ; la seconde moitié la recopie, et la piste glisse d'une moitié, en boucle, à 40 px par
// seconde. Seul le premier passage se lit (les copies sont cachées aux lecteurs d'écran). Avec « réduire les
// animations », un seul passage, immobile, coupé proprement. Sur l'accueil, qui affiche déjà ce qui passe en grand, la
// ligne fait défiler les phrases de Parabole.
const VITESSE = 40; // px par seconde, celle de l'ancien bandeau
let direct = [`<span class="titre">Parabole Radio</span>`, "Paris 18"]; // les morceaux de la ligne, en HTML échappé
let affiche = "";
const calme = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phrases = () => PHRASES_ACCUEIL.map((phrase) => escapeHtml(phrase));

/** Remet la ligne ON AIR à jour : ce qui passe, ou les phrases sur l'accueil (appelé aussi après chaque navigation). */
export function refreshTicker(force = false) {
  const ticker = document.getElementById("playerTicker");
  const piste = document.getElementById("playerTickerTrack");
  if (!ticker || !piste) return;
  const morceaux = document.documentElement.dataset.page === "accueil" ? phrases() : direct;
  const passage = morceaux.map((m) => `<span class="ecoute-morceau">${m}</span><i class="ecoute-carre" aria-hidden="true"></i>`).join("");
  const cle = passage + "|" + ticker.clientWidth + "|" + calme();
  if (!force && cle === affiche) return;
  affiche = cle;
  piste.innerHTML = `<span class="ecoute-moitie"><span class="ecoute-lu">${passage}</span></span>`;
  if (calme()) {
    ticker.classList.remove("defile");
    return;
  }
  // assez de passages pour couvrir la ligne, puis la même moitié une seconde fois : la boucle est sans couture (mesuré
  // en mode défilant, où rien ne coupe le passage)
  ticker.classList.add("defile");
  const largeur = piste.firstElementChild!.getBoundingClientRect().width || 1;
  const fois = Math.max(1, Math.ceil(ticker.clientWidth / largeur));
  const copies = passage.repeat(fois - 1);
  piste.innerHTML =
    `<span class="ecoute-moitie"><span class="ecoute-lu">${passage}</span>${copies ? `<span class="ecoute-copies" aria-hidden="true">${copies}</span>` : ""}</span>` +
    `<span class="ecoute-moitie" aria-hidden="true">${passage.repeat(fois)}</span>`;
  piste.style.setProperty("--duree", ((largeur * fois) / VITESSE).toFixed(1) + "s");
}
/** Ce que dit le direct, en morceaux de la ligne : une émission, puis son morceau ; sinon l'artiste et le titre. */
function setTicker(d: NowPlaying | null, waiting: boolean) {
  const morceau =
    d && !waiting
      ? (d.artist ? `${escapeHtml(d.artist)}<span class="entre"> — </span>` : "") + `<span class="titre">${escapeHtml(d.title)}</span>`
      : "";
  if (d && d.show) direct = [`<span class="emission">${escapeHtml(d.show)}</span>${morceau ? `<span class="entre"> ▸ </span>${morceau}` : ""}`];
  else direct = morceau ? [morceau] : [`<span class="titre">Parabole Radio</span>`, "Paris 18"];
  refreshTicker();
}
if ("ResizeObserver" in window) {
  const ticker = document.getElementById("playerTicker");
  let largeur = -1;
  if (ticker)
    new ResizeObserver(() => {
      if (ticker.clientWidth === largeur) return;
      largeur = ticker.clientWidth;
      refreshTicker();
    }).observe(ticker);
}
window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => refreshTicker(true));

// Ce qui passe, sur l'accueil : l'affichage façon chaîne (ON AIR ou OFF AIR, le titre et, à sa droite, les logos des
// plateformes où Hopper trouve le morceau, le sous-titre) et le texte « NOW PLAYING » (micro-spec). Ils sont dans le
// contenu de la page : cherchés à chaque fois, et remis à jour quand on revient sur l'accueil (refreshNowPlaying,
// appelé par router.ts). Ce qui change en cours de route clignote, comme le texte d'un téléviseur.
let microText = "—";
const headline = {
  etat: "On air",
  titre: "Parabole Radio",
  sousTitre: "Union de la jeunesse internationale community radio",
  morceau: null as Track | null, // ce que Hopper cherche sur les plateformes
};
export function refreshNowPlaying() {
  refreshTicker();
  const micro = document.getElementById("nowPlaying");
  if (micro) micro.textContent = microText;
  const state = document.getElementById("directEtat"),
    title = document.getElementById("directTitre"),
    subtitle = document.getElementById("directSousTitre"),
    platforms = document.getElementById("directPlateformes");
  if (platforms) {
    fillLogos(platforms, headline.morceau);
    askHopper([headline.morceau]);
  }
  if (!state || !title || !subtitle) return;
  const changed = title.textContent !== headline.titre || subtitle.textContent !== headline.sousTitre;
  state.textContent = headline.etat;
  title.textContent = headline.titre;
  subtitle.textContent = headline.sousTitre;
  subtitle.hidden = !headline.sousTitre;
  // le premier remplissage s'allume avec l'arrivée sur l'accueil (tele.css) ; ensuite, ce qui change clignote
  if (changed && "shown" in title.dataset)
    [title, subtitle].forEach((el) =>
      el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0.25, offset: 0.45 }, { opacity: 1 }], { duration: 420 }),
    );
  title.dataset.shown = "";
}

(function nowPlaying() {
  refreshTicker();
  // le morceau à l'antenne, et ce qui était à l'antenne au dernier coup d'œil (HISTORIQUE)
  let current: Play | null = null,
    shownOnAir = "";
  if (!NOWPLAYING_URL) return;
  function apply(d: NowPlaying & { played_at?: string }) {
    station.now = d;
    const waiting = !d.title || /en attente/i.test(d.title);
    setTicker(d, waiting);
    microText = waiting ? d.show || "—" : [d.artist, d.title].filter(Boolean).join(" — ");
    // l'affichage : une émission en titre, avec son morceau dessous ; sinon le morceau, avec son artiste
    headline.etat = d.source === "off" ? "Off air" : "On air";
    headline.morceau = waiting || !d.artist ? null : { title: d.title, artist: d.artist };
    headline.titre = d.show || (waiting ? "Parabole Radio" : d.title);
    headline.sousTitre = d.show
      ? waiting
        ? "Paris 18"
        : [d.artist, d.title].filter(Boolean).join(" — ")
      : waiting
        ? "Paris 18 · 24/7"
        : [d.artist, d.album].filter(Boolean).join(" · ");
    refreshNowPlaying();
    const key = waiting ? null : (d.artist || "") + "|" + d.title;
    if (current && key && key !== current.key) station.played = [current, ...station.played].slice(0, 20); // HISTORIQUE : le morceau qui vient de finir
    if (key && (!current || key !== current.key)) {
      // son heure de début : Radio Cult donne le début, Radiocompas l'avancement
      const start = Date.parse(d.received_at!) - (Number(d.elapsed) || 0) * 1000;
      current = {
        key,
        title: d.title,
        artist: d.artist,
        album: d.album,
        played_at: new Date(Number.isFinite(start) && start < Date.now() + 60000 ? start : Date.now()).toISOString(),
      };
    }
    if (key) d.played_at = current!.played_at;
    // HISTORIQUE ouvert suit tout de suite quand le morceau ou l'émission change
    const onAir = (d.show || "") + "|" + (key || "");
    if (onAir !== shownOnAir) {
      shownOnAir = onAir;
      if (historyOpen()) loadHistory();
    }
    if (radioControl) {
      radioControl.setOnAir(d.source !== "off");
      radioControl.setMeta(waiting ? (d.show ? { title: d.show } : null) : d);
    }
  }
  let pushed = 0; // l'heure du dernier message du temps réel
  async function poll() {
    try {
      const d = await fetchJson<NowPlaying>(NOWPLAYING_URL, { cache: "no-store" });
      // notre API garde ce qui passe quelques secondes : juste après un message du temps réel, elle peut être en retard
      if (Date.now() - pushed > 15000) apply(d);
    } catch (e) {
      /* garder les dernières valeurs ; la prochaine lecture réessaie */
    }
  }
  // Quand la station pousse le direct en temps réel (subscribe, lib/station), chaque changement arrive tout de suite et
  // une lecture par minute suffit pour rattraper un message perdu ; sinon, ou quand le lien tombe, une toutes les 10 s.
  let live = false,
    since = 0;
  subscribe(
    (d) => {
      pushed = Date.now();
      apply(d);
    },
    (up) => (live = up),
  );
  poll();
  setInterval(() => {
    since += 10;
    if (live && since < 60) return;
    since = 0;
    poll();
  }, 10000);
})();
