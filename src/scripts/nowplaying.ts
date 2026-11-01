// ---------- LE DIRECT (ce qui passe, NOWPLAYING_URL dans settings.ts) ----------
// Lit {title, artist, show, source, elapsed, duration, remaining, received_at, previous, next_autodj} toutes les 10 s ;
// entre deux lectures, le temps écoulé avance sur place.
import type { NowPlaying, Track } from "../lib/station/types";
import { radioControl } from "./audio";
import { historyOpen, loadHistory } from "./history";
import { askHopper, fillLogos } from "./hopper";
import { NOWPLAYING_URL } from "./settings";
import { station, type Play } from "./state";
import { escapeHtml, fetchJson } from "./util";

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
  const ticker = document.getElementById("playerTicker");
  const track = document.getElementById("playerTickerTrack")!;
  const progress = document.getElementById("playerProgress")!;
  const elapsedEl = document.getElementById("playerElapsed")!;
  const durationEl = document.getElementById("playerDuration")!;
  if (!ticker) return;
  let clock: { elapsed: number; duration: number; at: number } | null = null; // où en était le morceau à la dernière lecture
  let shown = ["Parabole Radio", "Paris 18"];
  const mmss = (s: number) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  // Le titre défile, comme la barre du haut, seulement quand il est trop long pour tenir.
  function setTicker(title: string, artist: string, force?: boolean) {
    if (!force && shown[0] === title && shown[1] === artist) return;
    shown = [title, artist];
    const item = (hidden: boolean) =>
      `<span class="player-ticker-item"${hidden ? ' aria-hidden="true"' : ""}>` +
      `<span class="title">${escapeHtml(title)}</span>${artist ? `<span class="artist">${escapeHtml(artist)}</span>` : ""}</span>`;
    track.innerHTML = item(false);
    const scroll = track.scrollWidth > ticker!.clientWidth;
    ticker!.classList.toggle("scrolling", scroll);
    if (scroll) track.insertAdjacentHTML("beforeend", item(true)); // une seconde copie rend la boucle sans couture
  }
  window.addEventListener("resize", () => setTicker(shown[0], shown[1], true));
  // le morceau à l'antenne, et ce qui était à l'antenne au dernier coup d'œil (HISTORIQUE)
  let current: Play | null = null,
    shownOnAir = "";
  function tick() {
    const known = !!(clock && clock.duration);
    progress.classList.toggle("unknown", !known);
    if (!known) {
      station.progress = null;
      elapsedEl.textContent = durationEl.textContent = "--:--";
      return;
    }
    const elapsed = Math.min(clock!.duration, clock!.elapsed + (Date.now() - clock!.at) / 1000);
    station.progress = elapsed / clock!.duration;
    elapsedEl.textContent = mmss(elapsed);
    durationEl.textContent = mmss(clock!.duration);
  }
  tick();
  setInterval(tick, 1000);
  if (!NOWPLAYING_URL) return;
  async function poll() {
    try {
      const d: NowPlaying & { played_at?: string } = await fetchJson<NowPlaying>(NOWPLAYING_URL, { cache: "no-store" });
      station.now = d;
      const waiting = !d.title || /en attente/i.test(d.title);
      if (d.show) setTicker(d.show, waiting ? "" : [d.title, d.artist].filter(Boolean).join(" — ")); // une émission : son nom, puis le morceau
      else setTicker(waiting ? "Parabole Radio" : d.title, waiting ? "Paris 18" : d.artist || "");
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
      const duration = Number(d.duration) || Number(d.elapsed) + Number(d.remaining) || 0;
      const at = Date.parse(d.received_at!);
      clock = duration
        ? {
            elapsed: Number(d.elapsed) || 0,
            duration,
            at: Number.isFinite(at) && Math.abs(Date.now() - at) < duration * 1000 ? at : Date.now(),
          }
        : null;
      tick();
    } catch (e) {
      /* garder les dernières valeurs ; la prochaine lecture réessaie */
    }
  }
  poll();
  setInterval(poll, 10000);
})();
