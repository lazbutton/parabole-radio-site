/** Les dates et les durées de l'admin, à la française et à l'heure de Paris. */
import { STATION_TIME_ZONE } from "@parabole/cms";

const dateTime = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const shortDay = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const longDay = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
const time = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const month = new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIME_ZONE, month: "long", year: "numeric" });
const ago = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

/** « sam. 13 juin 2026, 18:00 » */
export const parisDateTime = (at: Date) => dateTime.format(at);

/** « 13 juin 2026 » */
export const parisDay = (at: Date) => day.format(at);

/** « sam. 13 juin » : dans une liste rangée par mois, l'année est dans le titre du groupe. */
export const parisShortDay = (at: Date) => shortDay.format(at);

/** « sam. », « 13 », « juin » : les morceaux d'une petite page de calendrier. */
export function parisDayParts(at: Date): { weekday: string; dayOfMonth: string; month: string } {
  const parts = shortDay.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((one) => one.type === type)?.value ?? "";
  return { weekday: part("weekday"), dayOfMonth: part("day"), month: part("month") };
}

/** « samedi 13 juin » */
export const parisLongDay = (at: Date) => longDay.format(at);

/** « 18:00 » */
export const parisTime = (at: Date) => time.format(at);

/** « Juin 2026 » : le titre d'un groupe de la liste des shows. */
export function parisMonth(at: Date): string {
  const text = month.format(at);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « il y a 5 minutes », « hier », « dans 3 jours »… */
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

const calendarDay = new Intl.DateTimeFormat("en-CA", { timeZone: STATION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** « aujourd'hui », « demain », « dans 4 jours » : le jour de Paris d'une diffusion à venir, compté en jours. */
export function inDays(at: Date, now = new Date()): string {
  const days = Math.round((Date.parse(calendarDay.format(at)) - Date.parse(calendarDay.format(now))) / 86_400_000);
  return ago.format(days, "day");
}

/** « 2 h », « 1 h 30 », « 45 min » */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

const weight = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** « 9,6 Mo », « 430 ko » : le poids d'un fichier. */
export const megabytes = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} ko` : `${weight.format(bytes / 1_000_000)} Mo`);
