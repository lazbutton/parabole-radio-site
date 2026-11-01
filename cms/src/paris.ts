/**
 * L'heure de Paris, celle de la station : la base garde l'heure universelle, le site et l'admin montrent celle de
 * Paris. Rien que Intl : ce module sert aussi dans le navigateur.
 */

export const STATION_TIME_ZONE = "Europe/Paris";

const parisParts = new Intl.DateTimeFormat("en-US", {
  timeZone: STATION_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** L'heure de Paris à cet instant, champ par champ. */
function partsAt(at: Date): Record<"year" | "month" | "day" | "hour" | "minute" | "second", number> {
  return Object.fromEntries(parisParts.formatToParts(at).map((part) => [part.type, Number(part.value)])) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** Écart entre l'heure de Paris et l'heure universelle à cet instant, en millisecondes (1 h l'hiver, 2 h l'été). */
export function zoneOffset(at: Date): number {
  const parts = partsAt(at);
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** Minuit, heure de Paris, du jour où tombe cet instant. */
export function startOfParisDay(at: Date): Date {
  const local = new Date(at.getTime() + zoneOffset(at));
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight - zoneOffset(new Date(midnight)));
}

const pad = (value: number) => String(value).padStart(2, "0");

/** La valeur d'un champ <input type="datetime-local"> pour cet instant, à l'heure de Paris : « 2026-06-13T18:00 ». */
export function toParisInput(at: Date): string {
  const parts = partsAt(at);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * L'instant d'une date et d'une heure lues à Paris (« 2026-06-13T18:00 », secondes facultatives). Null si la saisie
 * n'est pas une date. Au passage à l'heure d'été, une heure qui n'existe pas (2 h 30) devient celle d'après (3 h 30) ;
 * au retour à l'heure d'hiver, une heure qui existe deux fois est prise à sa seconde occurrence.
 */
export function fromParisInput(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number, number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(naive);
  // 31 février, 25 h : refusés plutôt que reportés au lendemain.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const first = naive - zoneOffset(new Date(naive));
  const offset = zoneOffset(new Date(first));
  return new Date(naive - offset);
}
