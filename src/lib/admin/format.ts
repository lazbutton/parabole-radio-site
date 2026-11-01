/** Les dates et les durées de l'admin, à la française et à l'heure de Paris. */
import { STATION_TIME_ZONE } from "@parabole/cms";

const dateTime = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const ago = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

/** « sam. 13 juin 2026, 18:00 » */
export const parisDateTime = (at: Date) => dateTime.format(at);

/** « 13 juin 2026 » */
export const parisDay = (at: Date) => day.format(at);

/** « il y a 5 minutes », « hier »… */
export function since(at: Date, now = new Date()): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 30],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return ago.format(unit === "second" ? Math.min(-1, value) : value, unit);
    value = Math.round(value / size);
  }
  return ago.format(value, "year");
}

/** « 2 h », « 1 h 30 », « 45 min » */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}
