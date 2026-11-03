/**
 * L'import de la programmation Radio Cult (cms/README.md, 9.4). Chaque créneau de la période lue devient un show en
 * brouillon, relié à ses artistes ; un brouillon déjà importé suit son créneau ; un show publié n'est jamais réécrit,
 * seulement signalé quand il ne correspond plus. Rien n'est supprimé. Chaque passage laisse sa ligne au journal
 * (radiocult_import), que l'accueil de l'admin relit.
 *
 * Le site lit Radio Cult (src/lib/admin/imports.ts) et passe ici les créneaux traduits (traduction.ts) : aucun appel
 * réseau d'ici. Deux chemins, une seule logique : la tâche de nuit écrit avec la connexion du serveur (importRadioCult),
 * le bouton de l'accueil sous le rôle du membre qui l'a pressé (createAdmin().importRadioCult).
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { freeSlug } from "../admin/common.ts";
import { sameName } from "../admin/shows.ts";
import type { Db } from "../db.ts";
import { toParisInput } from "../paris.ts";
import { artist, member, radiocultImport, show, showArtist, type ContentStatus, type ImportChange, type ImportReport, type ImportTrigger } from "../schema.ts";
import { slugify } from "../slug.ts";
import { showTypeOf, type RadioCultArtist, type RadioCultSlot } from "./traduction.ts";

export { artistFromRadioCult, markdownFrom, slotKey, slotsFromRadioCult, type RadioCultArtist, type RadioCultSlot } from "./traduction.ts";

/** Ce que le site a lu chez Radio Cult pour une période : ses créneaux, ou la raison de l'échec. `notes` : ce qui a manqué. */
export type ImportInput = { from: Date; to: Date; notes?: string[] } & ({ slots: RadioCultSlot[] } | { error: string });

export type ImportResult = {
  id: string;
  ok: boolean;
  error: string | null;
  slots: number;
  created: number;
  updated: number;
  /** Les shows laissés tels quels : rien à changer, ou publiés (ceux-là, signalés s'ils ne correspondent plus). */
  unchanged: number;
  report: ImportReport;
};

/** Deux imports ne se croisent jamais : le second attend la fin du premier (verrou de la transaction). */
const LOCK = sql`select pg_advisory_xact_lock(hashtext('radiocult_import'))`;
/** Une occurrence d'une série qui change de jour retrouve le show de sa série, à trois jours près. */
const SAME_SERIES_WITHIN = 3 * 86_400_000;

const emptyReport = (notes: string[] = []): ImportReport => ({ created: [], updated: [], moved: [], gone: [], artistsCreated: [], artistsLinked: [], notes: [...notes] });

/** L'adresse d'un show importé : son titre et son jour à Paris, « podcast-2026-11-03 », le jour jamais coupé. */
const slugOf = (title: string, at: Date) => `${slugify(title).slice(0, 68).replace(/-+$/, "") || "show"}-${toParisInput(at).slice(0, 10)}`;

/** La durée d'un créneau, en secondes. */
const durationOf = (slot: RadioCultSlot) => Math.round((slot.end.getTime() - slot.start.getTime()) / 1000) || null;

/**
 * Les artistes de Radio Cult en fiches du CMS, une seule fois par import. Un artiste se retrouve par son identifiant
 * Radio Cult ; sinon par son nom (sans accents ni majuscules) ou son adresse, et la fiche trouvée est reliée s'il ne l'est
 * pas déjà à un autre ; sinon il naît en brouillon, invité, avec sa bio et ses liens. Un artiste sans nom est ignoré.
 */
function artistResolver(tx: Tx, report: ImportReport) {
  const known = new Map<string, string | null>();
  let unnamed = 0;
  async function idOf(found: RadioCultArtist): Promise<string | null> {
    if (known.has(found.id)) return known.get(found.id)!;
    let id: string | null = null;
    const [linked] = await tx.select({ id: artist.id }).from(artist).where(eq(artist.radiocultArtistId, found.id)).limit(1);
    if (linked) id = linked.id;
    else if (!found.name) unnamed++;
    else {
      const slug = slugify(found.name);
      const [same] = await tx
        .select({ id: artist.id, name: artist.name, radiocultArtistId: artist.radiocultArtistId })
        .from(artist)
        .where(or(sameName(artist.name, found.name), slug ? eq(artist.slug, slug) : undefined))
        // Une fiche encore libre d'abord, puis la plus ancienne.
        .orderBy(sql`${artist.radiocultArtistId} is null desc`, artist.createdAt)
        .limit(1);
      if (same) {
        id = same.id;
        if (!same.radiocultArtistId) {
          await tx.update(artist).set({ radiocultArtistId: found.id }).where(eq(artist.id, same.id));
          report.artistsLinked.push({ id: same.id, name: same.name });
        }
      } else {
        const [born] = await tx
          .insert(artist)
          .values({
            name: found.name,
            slug: await freeSlug(tx, artist, slug || "artiste"),
            role: "guest",
            status: "draft",
            bio: found.bio,
            links: found.links,
            radiocultArtistId: found.id,
          })
          .returning({ id: artist.id });
        id = born!.id;
        report.artistsCreated.push({ id, name: found.name });
      }
    }
    known.set(found.id, id);
    return id;
  }
  return {
    /** Les fiches de ces artistes, dans l'ordre, sans doublon (« Secri » et « SECRI » de Radio Cult font une fiche). */
    async idsOf(artists: RadioCultArtist[]): Promise<string[]> {
      const ids: string[] = [];
      for (const one of artists) {
        const id = await idOf(one);
        if (id && !ids.includes(id)) ids.push(id);
      }
      return ids;
    },
    unnamed: () => unnamed,
  };
}

/**
 * Importe les créneaux lus (ou note l'échec de la lecture), dans la transaction donnée : celle du serveur ou celle d'un
 * membre. Rend ce qui a été fait, aussi écrit au journal.
 */
export async function importSlots(tx: Tx, input: ImportInput, run: { trigger: ImportTrigger; memberId?: string | null }): Promise<ImportResult> {
  await tx.execute(LOCK);
  const report = emptyReport(input.notes);
  if ("error" in input) return record(tx, input, run, report, { slots: 0, created: 0, updated: 0, unchanged: 0 }, input.error);

  const slots = [...input.slots].sort((a, b) => a.start.getTime() - b.start.getTime());
  const keys = slots.map((slot) => slot.key);
  const columns = {
    id: show.id,
    title: show.title,
    status: show.status,
    broadcastAt: show.broadcastAt,
    durationSeconds: show.durationSeconds,
    description: show.description,
    key: show.radiocultEventId,
  };
  const known = new Map((keys.length ? await tx.select(columns).from(show).where(inArray(show.radiocultEventId, keys)) : []).map((row) => [row.key, row]));
  // Les shows importés prévus dans la période dont le créneau n'a pas été lu : disparus, ou passés à un autre jour.
  const missing = await tx
    .select(columns)
    .from(show)
    .where(and(isNotNull(show.radiocultEventId), gte(show.broadcastAt, input.from), lt(show.broadcastAt, input.to), keys.length ? notInArray(show.radiocultEventId, keys) : undefined));
  const artists = artistResolver(tx, report);
  const counts = { slots: slots.length, created: 0, updated: 0, unchanged: 0 };

  for (const slot of slots) {
    const duration = durationOf(slot);
    let current = known.get(slot.key);
    if (!current && slot.series) {
      // Une occurrence passée à un autre jour (une série déplacée, une émission avancée) reprend le show de sa série
      // le plus proche, au lieu d'en créer un second. Seul son lien au créneau change.
      const sameSeries = missing.filter((row) => row.key?.startsWith(`${slot.series}@`) && Math.abs(row.broadcastAt!.getTime() - slot.start.getTime()) <= SAME_SERIES_WITHIN);
      const closest = sameSeries.sort((a, b) => Math.abs(a.broadcastAt!.getTime() - slot.start.getTime()) - Math.abs(b.broadcastAt!.getTime() - slot.start.getTime()))[0];
      if (closest) {
        await tx.update(show).set({ radiocultEventId: slot.key }).where(eq(show.id, closest.id));
        missing.splice(missing.indexOf(closest), 1);
        current = { ...closest, key: slot.key };
      }
    }

    if (!current) {
      const title = slot.title || "Sans titre";
      const [born] = await tx
        .insert(show)
        .values({
          slug: await freeSlug(tx, show, slugOf(title, slot.start)),
          title,
          type: showTypeOf(slot),
          status: "draft",
          broadcastAt: slot.start,
          durationSeconds: duration,
          description: slot.description,
          radiocultEventId: slot.key,
        })
        .returning({ id: show.id });
      const ids = await artists.idsOf(slot.artists);
      if (ids.length) await tx.insert(showArtist).values(ids.map((artistId, position) => ({ showId: born!.id, artistId, position })));
      report.created.push({ id: born!.id, title, slotAt: slot.start.toISOString() });
      counts.created++;
      continue;
    }

    const change: ImportChange = {
      id: current.id,
      title: current.title,
      slotAt: slot.start.toISOString(),
      slotDuration: duration,
      showAt: current.broadcastAt?.toISOString() ?? null,
      showDuration: current.durationSeconds,
    };
    const moved = current.broadcastAt?.getTime() !== slot.start.getTime() || current.durationSeconds !== duration;
    if (current.status === "published") {
      // Jamais réécrit : à l'équipe de corriger la date sur la fiche, ou le créneau chez Radio Cult.
      if (moved) report.moved.push(change);
      counts.unchanged++;
      continue;
    }

    // Un brouillon suit son créneau, et reçoit ce qu'il n'a pas encore : ses artistes, sa description.
    const fields: Partial<typeof show.$inferInsert> = moved ? { broadcastAt: slot.start, durationSeconds: duration } : {};
    const filled: ImportChange["filled"] = [];
    if (!current.description?.trim() && slot.description) {
      fields.description = slot.description;
      filled.push("description");
    }
    if (slot.artists.length) {
      const [some] = await tx.select({ id: showArtist.artistId }).from(showArtist).where(eq(showArtist.showId, current.id)).limit(1);
      const ids = some ? [] : await artists.idsOf(slot.artists);
      if (ids.length) {
        await tx.insert(showArtist).values(ids.map((artistId, position) => ({ showId: current.id, artistId, position })));
        filled.push("artists");
      }
    }
    if (Object.keys(fields).length) await tx.update(show).set(fields).where(eq(show.id, current.id));
    if (moved || filled.length) {
      report.updated.push(filled.length ? { ...change, filled } : change);
      counts.updated++;
    } else counts.unchanged++;
  }

  for (const row of missing) report.gone.push({ id: row.id, title: row.title, status: row.status, showAt: row.broadcastAt!.toISOString() });
  const unnamed = artists.unnamed();
  if (unnamed) report.notes.push(`${unnamed > 1 ? `${unnamed} artistes` : "Un artiste"} de Radio Cult sans nom : ${unnamed > 1 ? "laissés" : "laissé"} de côté.`);
  return record(tx, input, run, report, counts);
}

/** Écrit le passage au journal. */
async function record(
  tx: Tx,
  input: ImportInput,
  run: { trigger: ImportTrigger; memberId?: string | null },
  report: ImportReport,
  counts: { slots: number; created: number; updated: number; unchanged: number },
  error: string | null = null,
): Promise<ImportResult> {
  const [row] = await tx
    .insert(radiocultImport)
    .values({ trigger: run.trigger, memberId: run.memberId ?? null, rangeStart: input.from, rangeEnd: input.to, ...counts, error, report })
    .returning({ id: radiocultImport.id });
  return { id: row!.id, ok: error === null, error, ...counts, report };
}

/** La tâche de nuit : la connexion du serveur, en propriétaire des tables. */
export const importRadioCult = (db: Db, input: ImportInput): Promise<ImportResult> => db.transaction((tx) => importSlots(tx, input, { trigger: "cron" }));

// ---------------------------------------------------------------------------------------------------------------
// Ce que l'admin en montre
// ---------------------------------------------------------------------------------------------------------------

/** Un passage de l'import : quand, lancé par qui (la tâche de nuit : null), réussi ou non, et ses nombres. */
export type ImportRun = {
  at: Date;
  trigger: ImportTrigger;
  by: string | null;
  ok: boolean;
  error: string | null;
  slots: number;
  created: number;
  updated: number;
  unchanged: number;
};

/**
 * L'état de l'import pour l'accueil : le dernier passage, et ce que le dernier passage réussi demande encore, relu
 * sur les fiches d'aujourd'hui. Un show supprimé depuis, publié depuis (pour ce qui était à compléter), ou corrigé
 * (pour ce qui était à corriger) n'y est plus.
 */
export type ImportStatus = {
  last: ImportRun | null;
  lastOk: ImportRun | null;
  created: ImportReport["created"];
  updated: ImportReport["updated"];
  moved: ImportReport["moved"];
  gone: { id: string; title: string; status: ContentStatus; showAt: string }[];
  artistsCreated: ImportReport["artistsCreated"];
  notes: string[];
};

export async function importStatus(tx: Tx): Promise<ImportStatus> {
  const columns = {
    at: radiocultImport.createdAt,
    trigger: radiocultImport.trigger,
    by: member.name,
    error: radiocultImport.error,
    slots: radiocultImport.slots,
    created: radiocultImport.created,
    updated: radiocultImport.updated,
    unchanged: radiocultImport.unchanged,
    report: radiocultImport.report,
  };
  const runs = (ok: boolean) =>
    tx
      .select(columns)
      .from(radiocultImport)
      .leftJoin(member, eq(member.userId, radiocultImport.memberId))
      .where(ok ? isNull(radiocultImport.error) : undefined)
      .orderBy(desc(radiocultImport.createdAt))
      .limit(1);
  const [last] = await runs(false);
  const [lastOk] = !last || last.error === null ? [last] : await runs(true);
  const asRun = (row: typeof last): ImportRun | null => {
    if (!row) return null;
    const { report: _report, ...run } = row;
    return { ...run, ok: run.error === null };
  };
  const status: ImportStatus = { last: asRun(last), lastOk: asRun(lastOk), created: [], updated: [], moved: [], gone: [], artistsCreated: [], notes: [] };
  if (!lastOk) return status;
  const report = { ...emptyReport(), ...lastOk.report } as ImportReport;

  const showIds = [...new Set([...report.created, ...report.updated, ...report.moved, ...report.gone].map((row) => row.id))];
  const shows = new Map(
    (showIds.length
      ? await tx
          .select({ id: show.id, title: show.title, status: show.status, broadcastAt: show.broadcastAt, durationSeconds: show.durationSeconds })
          .from(show)
          .where(inArray(show.id, showIds))
      : []
    ).map((row) => [row.id, row]),
  );
  const artistIds = report.artistsCreated.map((row) => row.id);
  const artists = new Map(
    (artistIds.length ? await tx.select({ id: artist.id, name: artist.name, status: artist.status }).from(artist).where(inArray(artist.id, artistIds)) : []).map((row) => [
      row.id,
      row,
    ]),
  );
  const draft = (id: string) => shows.get(id)?.status === "draft";
  return {
    ...status,
    created: report.created.filter((row) => draft(row.id)).map((row) => ({ ...row, title: shows.get(row.id)!.title })),
    updated: report.updated.filter((row) => draft(row.id)).map((row) => ({ ...row, title: shows.get(row.id)!.title })),
    moved: report.moved
      .filter((row) => {
        const now = shows.get(row.id);
        return now && (now.broadcastAt?.toISOString() !== row.slotAt || now.durationSeconds !== row.slotDuration);
      })
      .map((row) => {
        const now = shows.get(row.id)!;
        return { ...row, title: now.title, showAt: now.broadcastAt?.toISOString() ?? null, showDuration: now.durationSeconds };
      }),
    gone: report.gone.filter((row) => shows.has(row.id)).map((row) => ({ ...row, title: shows.get(row.id)!.title, status: shows.get(row.id)!.status })),
    artistsCreated: report.artistsCreated.filter((row) => artists.get(row.id)?.status === "draft").map((row) => ({ ...row, name: artists.get(row.id)!.name })),
    notes: report.notes,
  };
}

/** Les artistes de Radio Cult déjà reliés à une fiche : son identifiant Radio Cult, et la fiche. */
export async function radiocultLinks(tx: Tx): Promise<Map<string, { id: string; name: string }>> {
  const rows = await tx.select({ radiocultId: artist.radiocultArtistId, id: artist.id, name: artist.name }).from(artist).where(isNotNull(artist.radiocultArtistId));
  return new Map(rows.map((row) => [row.radiocultId!, { id: row.id, name: row.name }]));
}
