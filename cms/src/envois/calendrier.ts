/**
 * Le calendrier des deux groupes de résidents (cms/README.md, 9.12) : ils alternent à l'antenne par blocs de deux
 * semaines, du lundi au dimanche ; chacun envoie ses émissions avant sa deadline, le dimanche 15 jours avant le début
 * de son bloc. Rien que du calcul, sur des jours du calendrier de Paris (« 2026-12-14 ») : ce module sert aussi dans
 * le navigateur (@parabole/cms/envois).
 */
import { fromParisInput, toParisInput } from "../paris.ts";

export type Group = 1 | 2;

/** Le réglage du calendrier (table broadcast_cycle) : un lundi où le groupe 1 commence un bloc, la durée d'un bloc, la deadline. */
export type Cycle = { group1Start: string; blockDays: number; deadlineDays: number };

/** Un bloc : son groupe, son premier et son dernier jour, le jour de sa deadline. */
export type Block = { group: Group; start: string; end: string; deadline: string };

const DAY = 86_400_000;

const utcOf = (day: string): number => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date);
};

/** Ce jour, décalé de `n` jours. */
export function addDays(day: string, n: number): string {
  return new Date(utcOf(day) + n * DAY).toISOString().slice(0, 10);
}

/** Le nombre de jours de `from` à `to`. */
export const daysBetween = (from: string, to: string): number => Math.round((utcOf(to) - utcOf(from)) / DAY);

/** Le jour, à Paris, de cet instant. */
export const parisDay = (at: Date): string => toParisInput(at).slice(0, 10);

/** Le bloc `k` d'un groupe (0 : celui qui suit le lundi de référence pour le groupe 2 ; négatif : avant). */
function blockNumber(group: Group, cycle: Cycle, k: number): Block {
  const start = addDays(cycle.group1Start, (group === 1 ? 0 : cycle.blockDays) + k * 2 * cycle.blockDays);
  return { group, start, end: addDays(start, cycle.blockDays - 1), deadline: addDays(start, -cycle.deadlineDays) };
}

/** Le premier bloc du groupe qui commence après ce jour. */
export function nextBlock(group: Group, cycle: Cycle, day: string): Block {
  const first = addDays(cycle.group1Start, group === 1 ? 0 : cycle.blockDays);
  let k = Math.floor(daysBetween(first, day) / (2 * cycle.blockDays));
  while (blockNumber(group, cycle, k).start <= day) k++;
  while (blockNumber(group, cycle, k - 1).start > day) k--;
  return blockNumber(group, cycle, k);
}

/** Le bloc du groupe qui contient ce jour ; null si le groupe n'est pas à l'antenne ce jour-là. */
export function blockContaining(group: Group, cycle: Cycle, day: string): Block | null {
  const before = nextBlock(group, cycle, addDays(day, -cycle.blockDays));
  return before.start <= day && day <= before.end ? before : null;
}

/** Le groupe à l'antenne ce jour-là. */
export function groupOnAir(cycle: Cycle, day: string): Group {
  return blockContaining(1, cycle, day) ? 1 : 2;
}

/**
 * Les blocs proposés à un résident de ce groupe : le prochain. Entre sa deadline et son début, ce bloc reste proposé,
 * en retard, et le suivant l'est aussi.
 */
export function proposedBlocks(group: Group, cycle: Cycle, now: Date): { block: Block; late: boolean }[] {
  const today = parisDay(now);
  const next = nextBlock(group, cycle, today);
  if (today <= next.deadline) return [{ block: next, late: false }];
  return [
    { block: next, late: true },
    { block: nextBlock(group, cycle, next.start), late: false },
  ];
}

/** La prochaine deadline, tous groupes confondus : le dimanche même compte encore. */
export function nextDeadline(cycle: Cycle, now: Date): Block {
  const today = parisDay(now);
  const candidates = ([1, 2] as const).map((group) => {
    const next = nextBlock(group, cycle, today);
    return today <= next.deadline ? next : nextBlock(group, cycle, next.start);
  });
  return candidates.sort((a, b) => a.deadline.localeCompare(b.deadline))[0]!;
}

/** Un bloc dont la deadline est passée et qui n'a pas commencé : celui des retardataires, s'il y en a un. */
export function lateBlock(cycle: Cycle, now: Date): Block | null {
  const today = parisDay(now);
  for (const group of [1, 2] as const) {
    const next = nextBlock(group, cycle, today);
    if (today > next.deadline) return next;
  }
  return null;
}

/** Le bloc qui commence ce lundi-là, pour l'un ou l'autre groupe ; null si aucun bloc ne commence ce jour. */
export function blockStartingOn(cycle: Cycle, day: string): Block | null {
  for (const group of [1, 2] as const) {
    const block = nextBlock(group, cycle, addDays(day, -1));
    if (block.start === day) return block;
  }
  return null;
}

/** Les instants d'un bloc, à Paris : du premier jour à 0 h au lendemain du dernier à 0 h. Une semaine (1 ou 2) seulement, si elle est donnée. */
export function blockRange(block: Pick<Block, "start" | "end">, week?: 1 | 2 | null): { from: Date; to: Date } {
  const first = week === 2 ? addDays(block.start, 7) : block.start;
  const after = week === 1 ? addDays(block.start, 7) : addDays(block.end, 1);
  return { from: fromParisInput(`${first}T00:00`)!, to: fromParisInput(`${after}T00:00`)! };
}

/** La fin de la deadline : le dimanche, à 23 h 59 59 à Paris. */
export const deadlineAt = (block: Pick<Block, "deadline">): Date => fromParisInput(`${block.deadline}T23:59:59`)!;

const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const short = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** « dimanche 13 déc. », ou « 13 déc. » sans le jour de la semaine. */
export const dayLabel = (day: string, withWeekday = true): string => (withWeekday ? weekday : short).format(new Date(utcOf(day)));
