/**
 * L'import de la programmation Radio Cult dans le CMS (cms/README.md, 9.4), côté serveur : lire chez Radio Cult les
 * créneaux des 14 jours à venir et les artistes de la station, puis laisser le CMS écrire (importRadioCult pour la
 * tâche de nuit, src/pages/api/cron/radiocult.ts ; Astro.locals.admin.importRadioCult pour le bouton de l'accueil).
 * Et ce que l'admin en montre : le bloc de l'accueil, la liste des artistes de la station pour la fiche d'un artiste.
 */
import { artistFromRadioCult, slotsFromRadioCult, type ImportChange, type ImportInput, type ImportResult, type ImportStatus } from "@parabole/cms";
import type { RadioCultChoice, RadioCultPanel } from "../../components/admin/types";
import { counted } from "../../components/admin/text";
import { KEY, radiocult } from "../radiocult";
import { duration, parisDateTime, parisShortDay, parisTime, since } from "./format";

/** La période lue : les 14 jours à venir. */
export const IMPORT_DAYS = 14;

/** Pourquoi Radio Cult n'a pas répondu, en peu de mots. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = /HTTP (\d+)/.exec(message)?.[1];
  if (status) return `HTTP ${status}`;
  return error instanceof Error && error.name === "TimeoutError" ? "aucune réponse en 8 secondes" : "connexion impossible";
}

/**
 * Les créneaux des 14 jours à venir, avec leurs artistes quand la clé publishable permet de lire ceux de la station.
 * Un échec de la lecture devient sa raison, que l'import note au journal : rien n'est touché ce jour-là.
 */
export async function readProgramme(now = new Date()): Promise<ImportInput> {
  const from = now;
  const to = new Date(now.getTime() + IMPORT_DAYS * 86_400_000);
  const [programme, artists] = await Promise.allSettled([
    radiocult(`/schedule?startDate=${from.toISOString()}&endDate=${to.toISOString()}`),
    KEY ? radiocult("/artists") : Promise.resolve(null),
  ]);
  if (programme.status === "rejected") return { from, to, error: `Radio Cult n'a pas donné sa programmation (${reason(programme.reason)}).` };
  const notes: string[] = [];
  if (!KEY) notes.push("Sans la clé publishable de Radio Cult (PUBLIC_RADIOCULT_KEY), les artistes des créneaux ne sont pas lus.");
  else if (artists.status === "rejected")
    notes.push(`Radio Cult n'a pas donné ses artistes (${reason(artists.reason)}) : les brouillons créés les recevront au prochain import.`);
  const list = artists.status === "fulfilled" ? artists.value?.artists : null;
  return { from, to, notes, slots: slotsFromRadioCult(programme.value?.schedules, list) };
}

/** « 2 émissions créées, 1 mise à jour, 3 inchangées », ou la raison de l'échec. */
export function importSummary(result: Pick<ImportResult, "ok" | "error" | "slots" | "created" | "updated" | "unchanged">): string {
  if (!result.ok) return result.error ?? "L'import a échoué.";
  if (!result.slots) return "Aucun créneau dans les 14 jours à venir.";
  const parts = [
    result.created && counted(result.created, "émission créée", "émissions créées"),
    result.updated && counted(result.updated, "mise à jour", "mises à jour"),
    result.unchanged && counted(result.unchanged, "inchangée"),
  ].filter(Boolean);
  return `${parts.join(", ").replace(/^./, (first) => first.toUpperCase())}.`;
}

/** Une ligne des journaux de Vercel par import, avec ce qui reste à faire à la main. */
export function logImport(result: ImportResult, by: string) {
  const { moved, gone, artistsCreated, notes } = result.report;
  const line = [
    `Radio Cult, import (${by}) : ${importSummary(result)}`,
    moved.length && `${moved.length} publié(s) à corriger`,
    gone.length && `${gone.length} créneau(x) disparu(s)`,
    artistsCreated.length && `${artistsCreated.length} artiste(s) créé(s)`,
    ...notes,
  ].filter(Boolean);
  (result.ok ? console.log : console.warn)(line.join(" · "));
}

/** « mar. 16 juin, 18:00 » */
const slotDay = (iso: string) => `${parisShortDay(new Date(iso))}, ${parisTime(new Date(iso))}`;

/** La date d'un créneau, ou sa durée quand seule elle diffère : « mer. 17 juin, 19:00 », « 1 h 30 ». */
function slotSide(row: ImportChange, side: "slot" | "show"): string {
  const sameDate = row.showAt === row.slotAt;
  const at = side === "slot" ? row.slotAt : row.showAt;
  const seconds = side === "slot" ? row.slotDuration : row.showDuration;
  if (!sameDate) return at ? slotDay(at) : "sans date";
  return seconds ? duration(seconds) : "sans durée";
}

/** Ce que l'import a fait d'un brouillon : suivre son créneau, lui donner ses artistes ou sa description. */
function followed(row: ImportChange): string {
  const moved = row.showAt !== row.slotAt || row.showDuration !== row.slotDuration;
  const filled = (row.filled ?? []).map((part) => (part === "artists" ? "ses artistes" : "sa description"));
  return [moved && `Suit son créneau : ${slotSide(row, "slot")} (avant : ${slotSide(row, "show")})`, filled.length && `A reçu ${filled.join(" et ")}`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Le bloc Radio Cult de l'accueil : le dernier passage, puis ce que le dernier passage réussi demande encore. Sans
 * état (le journal manque dans la base), un bloc qui le dit.
 */
export function radiocultPanel(status: ImportStatus | null, now = new Date()): RadioCultPanel {
  if (!status)
    return {
      key: Boolean(KEY),
      unavailable: "Le journal de l'import manque dans la base : les migrations 0012 et 0013 du CMS ne sont pas encore appliquées (cms/README.md, 4.4).",
      last: null,
      lastOk: null,
      created: [],
      updated: [],
      moved: [],
      gone: [],
      artists: [],
      notes: [],
    };
  const run = (one: ImportStatus["last"]) =>
    one && {
      when: since(one.at, now),
      date: parisDateTime(one.at),
      by: one.trigger === "cron" ? "la tâche de nuit" : (one.by ?? "un membre de l'équipe"),
      ok: one.ok,
      summary: importSummary(one),
    };
  const show = (id: string) => `/admin/shows/${id}`;
  return {
    key: Boolean(KEY),
    unavailable: null,
    last: run(status.last),
    lastOk: status.last && !status.last.ok ? run(status.lastOk) : null,
    created: status.created.map((row) => ({ href: show(row.id), title: row.title, detail: slotDay(row.slotAt) })),
    updated: status.updated.map((row) => ({ href: show(row.id), title: row.title, detail: followed(row) })),
    moved: status.moved.map((row) => ({ href: show(row.id), title: row.title, detail: `Radio Cult : ${slotSide(row, "slot")} · la fiche : ${slotSide(row, "show")}` })),
    gone: status.gone.map((row) => ({
      href: show(row.id),
      title: row.title,
      detail: `Prévu ${slotDay(row.showAt)} · ${row.status === "published" ? "publié" : "brouillon"}`,
    })),
    artists: status.artistsCreated.map((row) => ({ href: `/admin/artistes/${row.id}`, title: row.name, detail: "Créé par l'import, en brouillon" })),
    notes: status.notes,
  };
}

let artistsCache: { at: number; choices: RadioCultChoice[] | null } | null = null;

/**
 * Les artistes de la station, pour relier une fiche : par ordre alphabétique, ceux sans nom à la fin. Gardés deux
 * minutes. La fiche s'ouvre sans attendre plus de 3 secondes : si Radio Cult ne répond pas, la dernière liste lue, ou
 * null (la fiche garde alors son lien tel quel), et un nouvel essai au bout de 30 secondes. Null sans clé publishable.
 */
export async function radiocultArtists(): Promise<RadioCultChoice[] | null> {
  if (!KEY) return null;
  if (artistsCache && Date.now() - artistsCache.at < (artistsCache.choices ? 120_000 : 30_000)) return artistsCache.choices;
  try {
    const { artists } = await radiocult("/artists", { timeout: 3000 });
    const choices = (Array.isArray(artists) ? artists : [])
      .map(artistFromRadioCult)
      .filter((one): one is NonNullable<typeof one> => one !== null)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => (!a.name !== !b.name ? (a.name ? -1 : 1) : a.name.localeCompare(b.name, "fr", { sensitivity: "base" })));
    artistsCache = { at: Date.now(), choices };
  } catch {
    // La liste d'avant, si elle a déjà été lue, vaut mieux que rien ; on réessaie dans 30 secondes.
    artistsCache = { at: Date.now() - (artistsCache?.choices ? 90_000 : 0), choices: artistsCache?.choices ?? null };
  }
  return artistsCache.choices;
}
