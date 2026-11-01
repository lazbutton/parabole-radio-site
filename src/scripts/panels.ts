// ---------- LES PANNEAUX : PROGRAMMATION, HISTORIQUE et CHAT ----------
// Une touche ouvre son panneau juste au-dessus du bandeau ; un seul à la fois sur écran étroit. Sur ordinateur,
// PROGRAMMATION est une fenêtre à part : toujours ouverte sur l'accueil (styles, html[data-page="accueil"]), ouverte à la
// demande ailleurs, sans fermer HISTORIQUE ni CHAT. Les panneaux sont dans la coque : ils restent ouverts, à leur place,
// d'une page à l'autre.
import { loadHistory } from "./history";
import { loadSchedule } from "./schedule";
import { CHAT_URL } from "./settings";
import { finePointer } from "./util";

export const popups = {
  schedule: document.getElementById("schedulePopup")!,
  lastplayed: document.getElementById("lastPlayedPopup")!,
  chat: document.getElementById("chatPopup")!,
};
type Which = keyof typeof popups;

const wide = () => !!window.matchMedia && window.matchMedia("(min-width: 821px)").matches;
/** PROGRAMMATION est-il épinglé (ordinateur, sur l'accueil) ? */
const schedulePinned = () => wide() && document.documentElement.dataset.page === "accueil";

/**
 * La hauteur du bandeau (--band-h) : PROGRAMMATION se centre dans la place au-dessus, les autres panneaux s'ouvrent
 * dessus, et le contenu des rubriques s'arrête là. Elle change quand PREVIOUS apparaît sur un écran étroit : suivie.
 */
function setBandHeight() {
  const band = document.getElementById("floatBottom"),
    height = band ? band.offsetHeight : 0;
  document.documentElement.style.setProperty("--band-h", height + "px");
  return height;
}
const bandEl = document.getElementById("floatBottom");
if (bandEl && "ResizeObserver" in window) new ResizeObserver(() => setBandHeight()).observe(bandEl);

export function togglePopup(which: Which) {
  const target = popups[which];
  if (!target) return;
  const willOpen = !target.classList.contains("open");
  (Object.keys(popups) as Which[]).forEach((k) => {
    if (wide() && (k === "schedule") !== (which === "schedule")) return; // sur ordinateur, PROGRAMMATION va seule
    popups[k].classList.remove("open");
  });
  if (willOpen) {
    const bandHeight = setBandHeight();
    if (which !== "schedule" && !("moved" in target.dataset)) target.style.bottom = bandHeight + 12 + "px"; // les autres : au-dessus du bandeau, s'ils n'ont pas été déplacés
    target.classList.add("open");
    restoreWindow(target);
    ({ schedule: loadSchedule, lastplayed: loadHistory, chat: loadChat })[which]();
  }
}
document.getElementById("scheduleToggle")?.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePopup("schedule");
});
document.getElementById("lastPlayedToggle")?.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePopup("lastplayed");
});
document.getElementById("playerPrevious")?.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePopup("lastplayed");
});
document.getElementById("scheduleClose")?.addEventListener("click", () => popups.schedule.classList.remove("open"));
document.getElementById("lastPlayedClose")?.addEventListener("click", () => popups.lastplayed.classList.remove("open"));
document.getElementById("chatClose")?.addEventListener("click", () => popups.chat.classList.remove("open"));

// CHAT : le chat de Radio Cult, dans un cadre créé à la première ouverture (rien de Radio Cult ne se charge avant), puis
// gardé, pour que la conversation reste telle quelle. Le panneau ne quitte jamais la page : le cadre ne se recharge pas.
const chatToggle = document.getElementById("chatToggle");
if (chatToggle && CHAT_URL) {
  chatToggle.hidden = false;
  chatToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopup("chat");
  });
}
function loadChat() {
  const body = document.getElementById("chatBody");
  if (!body || body.firstChild) return;
  const frame = document.createElement("iframe");
  frame.src = CHAT_URL;
  frame.title = "Chat de Parabole Radio";
  body.appendChild(frame);
}

// ---------- FENÊTRES : les panneaux se déplacent comme des fenêtres d'ordinateur ----------
// On en déplace un par sa barre de titre ; celui qu'on touche passe devant ; il ne peut pas quitter la fenêtre (un bout
// de sa barre reste toujours visible) ; un double-clic sur la barre le remet à sa place. Sa place est gardée dans ce
// navigateur (localStorage), d'une page et d'une visite à l'autre. Seulement à la souris ou au pavé tactile : sur
// téléphone, les panneaux prennent la largeur.
const SAVED_KEY = "parabole_panneaux";
const windowsOn = finePointer();
let saved: Record<string, { left: number; top: number }> = {};
try {
  saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "{}") || {};
} catch (e) {}
function save() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch (e) {}
}
// sous la barre du haut (menu compris)
const barBottom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--barre-h")) || 44;
const place = (panel: HTMLElement, left: number, top: number) => {
  // un bout de la barre de titre reste à portée
  const width = panel.offsetWidth;
  panel.style.left = Math.min(Math.max(left, 80 - width), innerWidth - 80) + "px";
  panel.style.top = Math.min(Math.max(top, barBottom()), innerHeight - 48) + "px";
};
/** Remet un panneau à la place où on l'a laissé (rien s'il n'a jamais été déplacé). */
function restoreWindow(panel: HTMLElement) {
  const s = windowsOn && saved[panel.id];
  if (!s) return;
  Object.assign(panel.style, { right: "auto", bottom: "auto", transform: "none" });
  panel.dataset.moved = "";
  if (panel.offsetWidth) place(panel, s.left, s.top);
  else Object.assign(panel.style, { left: s.left + "px", top: s.top + "px" }); // fermé : ajusté à son ouverture
}
function resetWindow(panel: HTMLElement) {
  (["left", "top", "right", "bottom", "transform"] as const).forEach((k) => {
    panel.style[k] = "";
  });
  delete panel.dataset.moved;
  const band = document.getElementById("floatBottom");
  if (panel !== popups.schedule && band) panel.style.bottom = band.offsetHeight + 12 + "px";
}

if (windowsOn) {
  let front = 40;
  Object.values(popups).forEach((panel) => {
    const bar = panel.querySelector<HTMLElement>(".popup-head, .sched-head");
    if (!bar) return;
    bar.classList.add("window-bar");
    bar.title = "Glisser pour déplacer · double-clic pour remettre en place";
    panel.addEventListener("pointerdown", () => {
      panel.style.zIndex = String(++front);
    });
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as Element).closest("button, a")) return;
      e.preventDefault();
      const r = panel.getBoundingClientRect(),
        dx = e.clientX - r.left,
        dy = e.clientY - r.top;
      Object.assign(panel.style, { right: "auto", bottom: "auto", transform: "none" });
      place(panel, r.left, r.top);
      panel.dataset.moved = "";
      panel.classList.add("dragging");
      bar.setPointerCapture(e.pointerId);
      let dragged = false; // un simple clic sur la barre (pour passer devant) n'est pas un déplacement
      const move = (ev: PointerEvent) => {
        if (!dragged && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
        dragged = true;
        place(panel, ev.clientX - dx, ev.clientY - dy);
      };
      const end = () => {
        panel.classList.remove("dragging");
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", end);
        bar.removeEventListener("pointercancel", end);
        if (dragged) {
          saved[panel.id] = { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) };
          save();
        } else if (!saved[panel.id]) resetWindow(panel); // jamais déplacé : il garde sa place par défaut
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", end);
      bar.addEventListener("pointercancel", end);
    });
    bar.addEventListener("dblclick", (e) => {
      if ((e.target as Element).closest("button, a")) return;
      resetWindow(panel);
      delete saved[panel.id];
      save();
    });
    restoreWindow(panel);
  });
}

// À l'arrivée sur une page (au chargement, puis après chaque navigation, router.ts) : la hauteur du bandeau, la
// PROGRAMMATION de l'accueil remplie, les panneaux à leur place.
let wasPinned = false;
export function pageChanged() {
  setBandHeight();
  wasPinned = schedulePinned();
  if (wasPinned) loadSchedule();
  Object.values(popups).forEach(restoreWindow);
}
window.addEventListener("resize", () => {
  setBandHeight();
  if (schedulePinned() && !wasPinned) loadSchedule(); // la fenêtre s'élargit : PROGRAMMATION apparaît, rempli
  wasPinned = schedulePinned();
  if (windowsOn) Object.values(popups).forEach((panel) => panel.offsetWidth && restoreWindow(panel));
});
