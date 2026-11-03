/**
 * Ce que partagent les pages des événements (src/pages/evenements/) et la rangée ÉVÉNEMENTS de la page d'un artiste :
 * où en est un événement (à venir, en ce moment, passé) et sa date, écrite à l'heure de Paris. La règle est celle du
 * CMS (cms/src/read/events.ts) : sans heure de fin, un événement reste à venir jusqu'à minuit, le jour où il commence.
 */
import { startOfParisDay, type EventCard } from "@parabole/cms";
import { STATION_TIMEZONE } from "../scripts/settings";

type Dates = Pick<EventCard, "startsAt" | "endsAt">;

const HEURE = 3_600_000;
const fr = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, ...options });
const heureDe = fr({ hour: "2-digit", minute: "2-digit" });
const courte = fr({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const longue = fr({ weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Les morceaux d'une date, le premier du mois écrit « 1er », comme en français. */
function morceaux(format: Intl.DateTimeFormat, date: Date) {
  const p = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  return { semaine: p.weekday ?? "", jour: p.day === "1" ? "1er" : (p.day ?? ""), mois: p.month ?? "", annee: p.year ?? "" };
}

/** Pas encore fini à cet instant. */
export function estAVenir({ startsAt, endsAt }: Dates, maintenant: Date): boolean {
  return endsAt ? endsAt >= maintenant : startsAt >= startOfParisDay(maintenant);
}

/** Sur plusieurs jours (une expo) : 24 heures ou plus. Une soirée qui finit à 2 h reste une date. */
const surPlusieursJours = ({ startsAt, endsAt }: Dates) => !!endsAt && endsAt.getTime() - startsAt.getTime() >= 24 * HEURE;

/** Une majuscule au début : « Samedi ». */
const capitale = (texte: string) => texte.charAt(0).toUpperCase() + texte.slice(1);

/**
 * La pastille d'un événement qui approche : « En ce moment » (commencé, pas fini), « Aujourd'hui », « Demain ». Rien
 * pour les autres, ni pour un événement passé.
 */
export function pastille(evenement: Dates, maintenant: Date): { texte: string; direct: boolean } | null {
  const { startsAt, endsAt } = evenement;
  if (!estAVenir(evenement, maintenant)) return null;
  if (endsAt && startsAt <= maintenant) return { texte: "En ce moment", direct: true };
  const aujourdhui = startOfParisDay(maintenant);
  // le lendemain à minuit : 30 heures après minuit tombent toujours le lendemain, même un jour de 23 ou 25 heures
  const demain = startOfParisDay(new Date(aujourdhui.getTime() + 30 * HEURE));
  const jour = startOfParisDay(startsAt).getTime();
  if (jour <= aujourdhui.getTime()) return { texte: "Aujourd'hui", direct: false };
  if (jour === demain.getTime()) return { texte: "Demain", direct: false };
  return null;
}

/**
 * La date d'une affiche de la liste. À venir : « sam. 15 nov. · 19:00 », l'année si ce n'est pas celle-ci. Passé :
 * « 15 nov. 2025 ». Sur plusieurs jours : « 3 → 13 oct. », « 28 oct. → 5 nov. 2025 ».
 */
export function dateCourte(evenement: Dates, maintenant: Date): string {
  const passe = !estAVenir(evenement, maintenant);
  const cetteAnnee = morceaux(courte, maintenant).annee;
  const debut = morceaux(courte, evenement.startsAt);
  if (surPlusieursJours(evenement)) {
    const fin = morceaux(courte, evenement.endsAt!);
    const annee = passe || fin.annee !== cetteAnnee ? ` ${fin.annee}` : "";
    if (debut.annee !== fin.annee) return `${debut.jour} ${debut.mois} ${debut.annee} → ${fin.jour} ${fin.mois} ${fin.annee}`;
    if (debut.mois === fin.mois) return `${debut.jour} → ${fin.jour} ${fin.mois}${annee}`;
    return `${debut.jour} ${debut.mois} → ${fin.jour} ${fin.mois}${annee}`;
  }
  if (passe) return `${debut.jour} ${debut.mois} ${debut.annee}`;
  const annee = debut.annee !== cetteAnnee ? ` ${debut.annee}` : "";
  return `${debut.semaine} ${debut.jour} ${debut.mois}${annee} · ${heureDe.format(evenement.startsAt)}`;
}

/**
 * La date de la page d'un événement : « Samedi 15 novembre 2026 · 19:00 → 02:00 » ; sur plusieurs jours, « Du 3 au
 * 13 octobre 2026 », « Du 28 octobre au 5 novembre 2026 ».
 */
export function dateLongue(evenement: Dates): string {
  const debut = morceaux(longue, evenement.startsAt);
  if (surPlusieursJours(evenement)) {
    const fin = morceaux(longue, evenement.endsAt!);
    if (debut.annee !== fin.annee) return `Du ${debut.jour} ${debut.mois} ${debut.annee} au ${fin.jour} ${fin.mois} ${fin.annee}`;
    if (debut.mois === fin.mois) return `Du ${debut.jour} au ${fin.jour} ${fin.mois} ${fin.annee}`;
    return `Du ${debut.jour} ${debut.mois} au ${fin.jour} ${fin.mois} ${fin.annee}`;
  }
  const horaire = heureDe.format(evenement.startsAt) + (evenement.endsAt ? ` → ${heureDe.format(evenement.endsAt)}` : "");
  return `${capitale(debut.semaine)} ${debut.jour} ${debut.mois} ${debut.annee} · ${horaire}`;
}

/** Les événements d'une rangée : ceux à venir d'abord, du plus proche au plus lointain, puis les passés, du plus récent. */
export function rangerParDate<T extends Dates>(evenements: T[], maintenant: Date): T[] {
  const aVenir = evenements.filter((evenement) => estAVenir(evenement, maintenant)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const passes = evenements.filter((evenement) => !estAVenir(evenement, maintenant)).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  return [...aVenir, ...passes];
}
