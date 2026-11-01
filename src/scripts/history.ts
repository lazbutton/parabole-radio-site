// ---------- HISTORIQUE (les derniers morceaux de la station, HISTORY_URL dans settings.ts) ----------
// Attend {items: [{played_at, title, artist, album}]}, du plus récent au plus ancien. En tête : ce que le direct sait,
// le morceau en cours et le suivant.
import type { History, Track } from "../lib/station/types";
import { askHopper, hopperSlot } from "./hopper";
import { HISTORY_URL, STATION_TIMEZONE } from "./settings";
import { station } from "./state";
import { escapeHtml, fetchJson, popupMessage, withQuery } from "./util";

const popupRow = (when: string, title: string, sub: string | undefined, now: boolean, extra = "") =>
  `<div class="popup-row${now ? " now" : ""}"><span class="when">${escapeHtml(when)}</span>` +
  `<span class="what">${escapeHtml(title)}${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ""}${extra}</span></div>`;
// Le code-barres d'un morceau : 16 barres dont les hauteurs viennent d'une empreinte de son artiste et de son titre.
function signature(text: string) {
  let h = 2166136261;
  for (const c of String(text)) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  let bars = "";
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    bars += `<i style="height:${25 + ((h >>> 0) % 76)}%"></i>`;
  }
  return `<span class="sig" aria-hidden="true">${bars}</span>`;
}
const popupSection = (text: string) => `<div class="popup-section">${escapeHtml(text)}</div>`;

/** Le même passage : même artiste et même titre, commencé à moins de 10 minutes d'écart (l'historique de Radio Cult et son direct ne donnent pas tout à fait le même début). */
export const samePlay = (a: Track | null | undefined, b: Track | null | undefined) =>
  !!(a && b) &&
  a.title.toLowerCase() === b.title.toLowerCase() &&
  (a.artist || "").toLowerCase() === (b.artist || "").toLowerCase() &&
  !(Math.abs(Date.parse(a.played_at!) - Date.parse(b.played_at!)) > 600000);

const isOpen = () => !!document.getElementById("lastPlayedPopup")?.classList.contains("open");

export async function loadHistory() {
  const list = document.getElementById("historyList")!;
  const np = station.now;
  let top = "";
  const sig = (t: Track) => `<span class="foot">${signature((t.artist || "") + " " + (t.title || ""))}${hopperSlot(t)}</span>`;
  // à l'antenne : le morceau, sinon l'émission (Radio Cult donne le nom de l'émission à l'antenne)
  const track = np && np.title && !/en attente/i.test(np.title) ? np : null;
  const onAir: Track | null = track || (np && np.show ? { title: np.show, artist: "" } : null);
  if (onAir) {
    top +=
      popupSection(track && np!.show ? "À l’antenne · " + np!.show : "À l’antenne") +
      popupRow("En cours", onAir.title, onAir.artist, true, sig(onAir));
    if (np!.next_autodj && np!.next_autodj.title)
      top += popupRow("Ensuite", np!.next_autodj.title, np!.next_autodj.artist, false, sig(np!.next_autodj));
  }
  if (!HISTORY_URL) {
    const before =
      np && np.previous && np.previous.title
        ? popupSection("Juste avant") + popupRow("Avant", np.previous.title, np.previous.artist, false, sig(np.previous))
        : "";
    list.innerHTML = top + before || popupMessage("Historique bientôt disponible.");
    return;
  }
  if (!list.innerHTML) list.innerHTML = top + popupMessage("Chargement…");
  try {
    const { items = [] } = await fetchJson<History>(withQuery(HISTORY_URL, "limit=20"), { cache: "no-store" });
    // La station inscrit un morceau quelques minutes après sa fin : les morceaux vus passer sur cette page comblent le
    // trou. Le morceau à l'antenne est « En cours », pas ici.
    const played = items
      .concat(station.played.filter((p) => !items.some((it) => samePlay(it, p))))
      .filter((it) => !samePlay(it, track))
      .sort((a, b) => (Date.parse(b.played_at!) || 0) - (Date.parse(a.played_at!) || 0))
      .slice(0, 20);
    const hour = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, hour: "2-digit", minute: "2-digit" });
    list.innerHTML =
      top +
      popupSection("Déjà diffusés") +
      (played.length
        ? played.map((it) => popupRow(hour.format(new Date(it.played_at!)), it.title, it.artist, false, sig(it))).join("")
        : popupMessage("Rien pour l’instant."));
    askHopper([track, ...played]);
  } catch (e) {
    list.innerHTML = top + popupMessage("Historique indisponible pour le moment.", "Réessayez dans un instant.");
  }
}

// garder HISTORIQUE ouvert à jour au fil des morceaux
setInterval(() => {
  if (isOpen()) loadHistory();
}, 20000);

/** HISTORIQUE est-il ouvert (le direct le met à jour dès que le morceau change) ? */
export const historyOpen = isOpen;
