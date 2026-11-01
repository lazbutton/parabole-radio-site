// ---------- PROGRAMMATION (la programmation de la station, SCHEDULE_URL dans settings.ts) ----------
// Attend {timezone, items: [{starts_at, ends_at, title, kind}]} pour les 7 prochains jours (format Radiocompas, que
// sert notre API).
import type { Schedule } from "../lib/station/types";
import { SCHEDULE_URL, STATION_TIMEZONE } from "./settings";
import { escapeHtml, fetchJson, popupMessage } from "./util";

const schedule = { data: null as Schedule | null, at: 0, day: null as string | null };
const panel = () => document.getElementById("schedulePopup");

export async function loadSchedule() {
  const days = document.getElementById("scheduleDays")!;
  const list = document.getElementById("scheduleList")!;
  if (!SCHEDULE_URL) {
    days.innerHTML = "";
    list.innerHTML = popupMessage("Programmation bientôt disponible.", "En attendant : musique en continu, 24 h sur 24.");
    return;
  }
  if (schedule.data && Date.now() - schedule.at < 5 * 60 * 1000) return renderSchedule();
  list.innerHTML = popupMessage("Chargement…");
  try {
    schedule.data = await fetchJson<Schedule>(SCHEDULE_URL);
    schedule.at = Date.now();
    renderSchedule();
  } catch (e) {
    list.innerHTML = popupMessage("Programmation indisponible pour le moment.", "Réessayez dans un instant.");
  }
}

// La journée comme une ligne : chaque émission est un arrêt (sa part de la journée, pour une émission qui passe minuit),
// la musique en continu remplit les creux. Aujourd'hui, ce qui est passé est atténué et ce qui passe est une carte
// jaune avec son avancement ; la liste s'ouvre dessus.
type Row = { gap?: boolean; from: number; to: number; title?: string; kind?: string };
export function renderSchedule(keepScroll?: boolean) {
  if (!schedule.data) return;
  const days = document.getElementById("scheduleDays")!;
  const list = document.getElementById("scheduleList")!;
  const dateLine = document.getElementById("scheduleDate")!;
  const clockLine = document.getElementById("scheduleClock");
  const timeZone = schedule.data.timezone || STATION_TIMEZONE;
  const dayKey = new Intl.DateTimeFormat("fr-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); // AAAA-MM-JJ
  const weekday = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat("fr-FR", { timeZone, day: "numeric" });
  const fullDate = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "long", day: "numeric", month: "long" });
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const minuteOfDay = (d: Date) => {
    const [hh, mm] = clock.format(d).split(":").map(Number);
    return hh * 60 + mm;
  };
  const now = new Date();
  const items = (schedule.data.items || []).map((it) => ({ ...it, start: new Date(it.starts_at), end: new Date(it.ends_at) }));
  const ofDay = (k: string): Row[] =>
    items
      .map((it) => {
        const from = dayKey.format(it.start) === k ? minuteOfDay(it.start) : dayKey.format(it.end) === k ? 0 : null;
        if (from === null) return null;
        const to = dayKey.format(it.end) === k ? minuteOfDay(it.end) : 1440;
        return to > from ? { ...it, from, to } : null;
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => a.from - b.from);
  const keys: string[] = [],
    dates: Record<string, Date> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86400000),
      k = dayKey.format(d);
    keys.push(k);
    dates[k] = d;
  }
  if (!schedule.day || !keys.includes(schedule.day)) schedule.day = keys[0];
  const day = schedule.day;
  days.innerHTML = keys
    .map(
      (k, i) =>
        `<button type="button" class="sched-day" role="tab" aria-selected="${k === day}" data-day="${k}">` +
        `<span class="dow">${i === 0 ? "auj." : escapeHtml(weekday.format(dates[k]).replace(".", ""))}</span>` +
        `<span class="num">${escapeHtml(dayNumber.format(dates[k]))}</span>` +
        `<span class="dots">${"<i></i>".repeat(Math.min(3, ofDay(k).length))}</span></button>`,
    )
    .join("");
  const today = day === keys[0];
  dateLine.textContent = (today ? "Aujourd’hui · " : "") + fullDate.format(dates[day]) + " · heure de Paris";
  const rows: Row[] = [];
  let cursor = 0;
  for (const it of ofDay(day)) {
    if (it.from > cursor) rows.push({ gap: true, from: cursor, to: it.from });
    rows.push(it);
    cursor = Math.max(cursor, it.to);
  }
  if (cursor < 1440) rows.push({ gap: true, from: cursor, to: 1440 });
  const nowMinute = today ? minuteOfDay(now) : -1;
  if (clockLine) clockLine.textContent = clock.format(now);
  const hhmm = (m: number) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const lasting = (m: number) =>
    m >= 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + String(m % 60).padStart(2, "0") : "") : m + " min";
  const KINDS: Record<string, string> = { direct: "En direct", set: "Set" }; // kind : emission, set (enregistré) ou direct
  const keep = list.scrollTop;
  list.innerHTML = rows
    .map((r) => {
      const live = r.from <= nowMinute && nowMinute < r.to,
        gone = today && r.to <= nowMinute;
      const meta = (live ? ['<span class="sched-live">On air</span>', "encore " + lasting(r.to - nowMinute)] : [lasting(r.to - r.from)]).concat(
        !r.gap && r.kind && KINDS[r.kind] ? [`<span class="sched-tag">${KINDS[r.kind]}</span>`] : [],
      );
      const progress = live
        ? `<div class="sched-progress"><i style="width:${((100 * (nowMinute - r.from)) / (r.to - r.from)).toFixed(1)}%"></i></div>`
        : "";
      const height = Math.round(
        r.gap ? Math.min(84, Math.max(44, (r.to - r.from) * 0.12)) : Math.min(120, Math.max(56, (r.to - r.from) * 0.35)),
      ); // plus haute quand ça dure plus longtemps
      return (
        `<div class="sched-row${r.gap ? " gap" : ""}${live ? " now" : ""}${gone ? " past" : ""}" style="min-height:${height}px">` +
        `<span class="sched-time">${hhmm(r.from)}<small>${hhmm(r.to)}</small></span><span class="sched-rail" aria-hidden="true"></span>` +
        `<div class="sched-body"><div class="sched-name">${escapeHtml(r.gap ? "Musique en continu" : r.title)}</div>` +
        `<div class="sched-meta">${meta.join("")}</div>${progress}</div></div>`
      );
    })
    .join("");
  const onAir = list.querySelector<HTMLElement>(".sched-row.now");
  list.scrollTop = keepScroll ? keep : onAir ? onAir.offsetTop - 12 : 0;
}

document.getElementById("scheduleDays")?.addEventListener("click", (e) => {
  const tab = (e.target as Element).closest<HTMLElement>(".sched-day");
  if (!tab) return;
  e.stopPropagation();
  schedule.day = tab.dataset.day!;
  renderSchedule();
});
// garder la PROGRAMMATION affichée à jour : ce qui passe, et son avancement
setInterval(() => {
  const p = panel();
  if (p && p.offsetWidth && schedule.data) renderSchedule(true);
}, 30000);
