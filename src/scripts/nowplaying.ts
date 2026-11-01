// ---------- LE DIRECT (ce qui passe, NOWPLAYING_URL dans settings.ts) ----------
// Lit {title, artist, show, source, elapsed, duration, remaining, received_at, previous, next_autodj} toutes les 10 s ;
// entre deux lectures, le temps écoulé avance sur place.
import type { History, NowPlaying } from "../lib/station/types";
import { radioControl } from "./audio";
import { historyOpen, loadHistory, samePlay } from "./history";
import { HISTORY_URL, NOWPLAYING_URL } from "./settings";
import { station, type Play } from "./state";
import { escapeHtml, fetchJson, withQuery } from "./util";

// Le texte « NOW PLAYING » de l'accueil (micro-spec) est dans le contenu de la page : il est cherché à chaque fois, et
// remis à jour quand on revient sur l'accueil (refreshNowPlaying, appelé par router.ts).
let microText = "—";
export function refreshNowPlaying() {
  const micro = document.getElementById("nowPlaying");
  if (micro) micro.textContent = microText;
}

(function nowPlaying() {
  const ticker = document.getElementById("playerTicker");
  const track = document.getElementById("playerTickerTrack")!;
  const progress = document.getElementById("playerProgress")!;
  const elapsedEl = document.getElementById("playerElapsed")!;
  const durationEl = document.getElementById("playerDuration")!;
  const prevBtn = document.getElementById("playerPrevious");
  const prevText = document.getElementById("playerPreviousText")!;
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
  // PREVIOUS, sous le bandeau : le morceau d'avant. Radiocompas le donne (previous) ; avec Radio Cult, l'historique le
  // donne à l'arrivée, puis les changements vus ici prennent le relais.
  let current: Play | null = null,
    askedHistory = false,
    seenChange = false,
    shownOnAir = "";
  function setPrevious(t: { title: string; artist?: string } | null | undefined) {
    if (!prevBtn || !t || !t.title) return;
    prevText.textContent = [t.title, t.artist].filter(Boolean).join(" — ");
    prevBtn.hidden = false;
  }
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
      refreshNowPlaying();
      const key = waiting ? null : (d.artist || "") + "|" + d.title;
      const changed = !!(current && key && key !== current.key);
      if (changed) {
        seenChange = true;
        station.played = [current!, ...station.played].slice(0, 20); // HISTORIQUE : le morceau qui vient de finir
      }
      if (d.previous && d.previous.title) setPrevious(d.previous);
      else if (changed) setPrevious(current);
      else if (!askedHistory && HISTORY_URL) {
        askedHistory = true;
        // La station inscrit un morceau quelques minutes après sa fin : redemandé 3 minutes plus tard, sauf si un
        // changement vu ici l'a donné entre-temps
        const ask = () =>
          fetchJson<History>(withQuery(HISTORY_URL, "limit=3"), { cache: "no-store" })
            .then((h) => {
              const before = (h.items || []).find((it) => !samePlay(it, current));
              if (before && !seenChange) setPrevious(before);
            })
            .catch(() => {});
        ask();
        setTimeout(ask, 180000);
      }
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
