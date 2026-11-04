/**
 * Les envois des résidents (cms/README.md, 9.12) : ce que fait la page `/envoyer/<jeton>`. Un DJ, un podcasteur ou un
 * curateur, sans compte, y envoie ses émissions et y met à jour sa bio et sa photo.
 *
 * Tout passe par la connexion du serveur, en propriétaire des tables, une fois le jeton vérifié, comme l'antenne libre
 * (src/chat/) et l'import Radio Cult : le public n'a aucun droit sur ces tables. Chaque fonction ne touche donc qu'à ce
 * qui appartient à l'artiste du lien : ses brouillons, ses fichiers, sa fiche. Un show reste toujours en brouillon :
 * seule l'équipe publie.
 */
import { clampEnergy } from "../labels.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import type { NotSaved } from "../admin/common.ts";
import { emptyShowForm, isUuid, LIMITS, readShowForm, type FieldErrors, type MediaText, type ShowForm } from "../admin/input.ts";
import { addMedia, getMedia, placeMedia, releaseMedia, type AdminMedia, type MediaUpload } from "../admin/media.ts";
import { getShow, saveShow, type AdminShow } from "../admin/shows.ts";
import { tagChoices, type AdminFacetChoice, type AdminTagChoice } from "../admin/tags.ts";
import type { Db } from "../db.ts";
import { toParisInput } from "../paris.ts";
import { artist, audioFile, broadcastCycle, show, showArtist, showType, submission, tag, uploadLink, type AudioStatus, type ShowType } from "../schema.ts";
import { formatTimecode, type TrackLine } from "../tracklist.ts";
import { proposedBlocks, type Block, type Cycle, type Group } from "./calendrier.ts";
import { audioKey, audioRefusal, audioTypeOf, MAX_MAIN_BYTES, MAX_PART_BYTES, MAX_PARTS, MAX_PLAYLIST_BYTES, STUCK_SENDING_MS, type AudioRole } from "./fichiers.ts";

/** Un jeton de lien : 32 octets aléatoires en base64url. */
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const newToken = (): string => randomBytes(32).toString("base64url");

/** Un fichier en cours d'envoi depuis plus d'un jour est abandonné (un envoi vers SoundCloud : STUCK_SENDING_MS). */
const STALE_UPLOAD_MS = 24 * 3600_000;
/** Ce qu'un même lien peut avoir en cours d'envoi en même temps. */
const MAX_PENDING = MAX_PARTS + 10;

export type EnvoiArtist = { id: string; name: string; group: Group | null; bio: string | null; photo: AdminMedia | null };
/** Un show que l'artiste peut remplir ou corriger : un de ses envois, ou un créneau de la grille déjà posé pour lui. */
export type EnvoiItem = {
  showId: string;
  title: string;
  type: ShowType;
  broadcastAt: Date | null;
  /** Le show vient d'un créneau Radio Cult (sinon, c'est un envoi qui attend sa place sur la grille). */
  slot: boolean;
  /** Un envoi : le lundi de son bloc, sa semaine, son son et ses morceaux. Null pour un créneau encore vide. */
  envoi: { blockStart: string | null; week: 1 | 2 | null; main: { fileName: string; status: AudioStatus } | null; parts: number; sentAt: Date | null } | null;
};
export type EnvoiPage = {
  artist: EnvoiArtist;
  cycle: Cycle | null;
  /** Ses blocs, pour un résident d'un groupe : le prochain, et en retard celui dont la deadline vient de passer. */
  blocks: { block: Block; late: boolean }[];
  items: EnvoiItem[];
  choices: { facets: AdminFacetChoice[]; tags: AdminTagChoice[] };
};
export type EnvoiPart = { id: string; position: number; artist: string; title: string; durationSeconds: number | null; fileName: string; sizeBytes: number | null };
/** Un show à remplir, tel que la page le montre. */
export type EnvoiFiche = {
  showId: string;
  version: string;
  title: string;
  type: ShowType;
  broadcastAt: Date | null;
  slot: boolean;
  description: string;
  energy: number | null;
  tags: string[];
  tracks: TrackLine[];
  cover: AdminMedia | null;
  note: string;
  link: string;
  blockStart: string | null;
  week: 1 | 2 | null;
  main: { fileName: string; status: AudioStatus; sizeBytes: number | null } | null;
  parts: EnvoiPart[];
};

/** Ce que la page envoie pour une émission : la fiche, et les fichiers déjà déposés dans le seau. */
export type EnvoiForm = {
  /** Le show d'un créneau ou d'un envoi déjà fait ; vide : un nouvel envoi. */
  showId: string;
  version: string;
  /** Un nouvel envoi : son type, et le lundi de son bloc (résident d'un groupe). */
  type: string;
  blockStart: string;
  week: string;
  title: string;
  description: string;
  energy: string;
  tags: string[];
  tracks: TrackLine[];
  pasted: string;
  note: string;
  link: string;
  /** Le son du show, envoyé à l'instant (une ligne audio_file « uploading ») ; vide : celui d'avant reste. */
  main: string;
  /** Les morceaux d'une playlist, dans l'ordre : ceux déjà là et ceux envoyés à l'instant. */
  parts: { id: string; artist: string; title: string; duration: string }[];
  /** Une pochette déjà inscrite (ajouterImage) ; « none » : retirée ; vide : inchangée. */
  cover: string;
};

export type Deposited = { ok: true; showId: string; removedKeys: string[]; removedImages: string[] };

/** Le cycle des groupes, ou null s'il n'est pas réglé. */
export async function readCycle(tx: Tx): Promise<Cycle | null> {
  const [row] = await tx.select({ group1Start: broadcastCycle.group1Start, blockDays: broadcastCycle.blockDays, deadlineDays: broadcastCycle.deadlineDays }).from(broadcastCycle).limit(1);
  return row ?? null;
}

/** L'artiste d'un lien ; null pour un jeton inconnu. */
async function linkOf(tx: Tx, jeton: string): Promise<(EnvoiArtist & { photoId: string | null }) | null> {
  if (!TOKEN.test(jeton)) return null;
  const [row] = await tx
    .select({ id: artist.id, name: artist.name, group: artist.broadcastGroup, bio: artist.bio, photoId: artist.photoId })
    .from(uploadLink)
    .innerJoin(artist, eq(artist.id, uploadLink.artistId))
    .where(eq(uploadLink.token, jeton))
    .limit(1);
  if (!row) return null;
  return { ...row, group: row.group === 1 || row.group === 2 ? row.group : null, photo: await getMedia(tx, row.photoId) };
}

/** Le son actif d'un show (reçu, validé, en partance, publié ou refusé). */
const mainOf = (tx: Tx, showId: string) =>
  tx
    .select({ id: audioFile.id, key: audioFile.key, fileName: audioFile.fileName, status: audioFile.status, sizeBytes: audioFile.sizeBytes, sentAt: audioFile.sentAt })
    .from(audioFile)
    .where(and(eq(audioFile.showId, showId), eq(audioFile.role, "main"), ne(audioFile.status, "uploading")))
    .limit(1)
    .then((rows) => rows[0] ?? null);

/**
 * Le show peut-il être rempli par cet artiste ? Un brouillon dont il est l'un des artistes, ou qu'il a envoyé, et dont
 * le son n'est pas déjà parti sur SoundCloud.
 */
async function editable(tx: Tx, artistId: string, showId: string): Promise<boolean> {
  if (!isUuid(showId)) return false;
  const [row] = await tx
    .select({ id: show.id })
    .from(show)
    .where(
      and(
        eq(show.id, showId),
        eq(show.status, "draft"),
        sql`(exists (select 1 from ${showArtist} sa where sa.show_id = ${show.id} and sa.artist_id = ${artistId})
          or exists (select 1 from ${submission} su where su.show_id = ${show.id} and su.artist_id = ${artistId}))`,
        sql`not exists (select 1 from ${audioFile} af where af.show_id = ${show.id} and af.role = 'main' and af.status in ('sending', 'sent'))`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** La fiche d'un show telle que readShowForm l'attend, pour la compléter de ce que l'artiste envoie. */
function formOfShow(current: AdminShow): ShowForm {
  return {
    ...emptyShowForm(),
    title: current.title,
    slug: current.slug,
    type: current.type,
    broadcastAt: current.broadcastAt ? toParisInput(current.broadcastAt) : "",
    duration: current.durationSeconds ? formatTimecode(current.durationSeconds) : "",
    energy: current.energy === null ? "" : String(clampEnergy(current.energy)),
    description: current.description ?? "",
    soundcloudUrl: current.soundcloudUrl ?? "",
    soundcloudTrackId: current.soundcloudTrackId ?? "",
    artists: current.artists.map((one) => one.id),
    tags: current.tags.map((one) => one.id),
    tracks: current.tracks.map((line) => ({ artist: line.artist, title: line.title, start: line.startSeconds === null ? "" : formatTimecode(line.startSeconds), hopperUrl: line.hopperUrl ?? "" })),
  };
}

const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

export function createEnvois(db: Db, { now: clock = () => new Date() }: { now?: () => Date } = {}) {
  return {
    /** Ce lien existe-t-il ? Avant de signer quoi que ce soit pour lui (une image à déposer). */
    connu: (jeton: string): Promise<boolean> => db.transaction(async (tx) => Boolean(await linkOf(tx, jeton))),

    /** La page d'un lien : l'artiste, ses blocs, ses envois et ses créneaux, les étiquettes à cocher. Null pour un lien inconnu. */
    ouvrir: (jeton: string): Promise<EnvoiPage | null> =>
      db.transaction(async (tx) => {
        const now = clock();
        const who = await linkOf(tx, jeton);
        if (!who) return null;
        await tx.update(uploadLink).set({ usedAt: now }).where(eq(uploadLink.artistId, who.id));
        const cycle = await readCycle(tx);
        const blocks = who.group && cycle ? proposedBlocks(who.group, cycle, now) : [];
        const since = new Date(now.getTime() - 90 * 86_400_000);
        const until = new Date(now.getTime() + 45 * 86_400_000);
        const rows = await tx
          .select({
            showId: show.id,
            title: show.title,
            type: show.type,
            broadcastAt: show.broadcastAt,
            slot: sql<boolean>`${show.radiocultEventId} is not null`,
            submitted: sql<boolean>`${submission.showId} is not null`,
            blockStart: submission.blockStart,
            week: submission.week,
            mainName: sql<string | null>`(select af.file_name from ${audioFile} af where af.show_id = ${show.id} and af.role = 'main' and af.status <> 'uploading' limit 1)`,
            mainStatus: sql<AudioStatus | null>`(select af.status from ${audioFile} af where af.show_id = ${show.id} and af.role = 'main' and af.status <> 'uploading' limit 1)`,
            sentAt: sql<Date | null>`(select af.sent_at from ${audioFile} af where af.show_id = ${show.id} and af.role = 'main' and af.status <> 'uploading' limit 1)`.mapWith((value) => (value ? new Date(value as string) : null)),
            parts: sql<number>`(select count(*) from ${audioFile} af where af.show_id = ${show.id} and af.role = 'part' and af.status = 'received')`.mapWith(Number),
          })
          .from(show)
          .leftJoin(submission, eq(submission.showId, show.id))
          .where(
            and(
              eq(show.status, "draft"),
              or(
                eq(submission.artistId, who.id),
                and(
                  isNotNull(show.radiocultEventId),
                  sql`exists (select 1 from ${showArtist} sa where sa.show_id = ${show.id} and sa.artist_id = ${who.id})`,
                  gte(show.broadcastAt, since),
                  lt(show.broadcastAt, until),
                ),
              ),
            ),
          )
          .orderBy(sql`${show.broadcastAt} asc nulls first`, desc(show.createdAt));
        const items: EnvoiItem[] = rows.map((row) => ({
          showId: row.showId,
          title: row.title,
          type: row.type,
          broadcastAt: row.broadcastAt,
          slot: row.slot,
          envoi:
            row.submitted || row.mainStatus
              ? {
                  blockStart: row.blockStart,
                  week: row.week === 1 || row.week === 2 ? row.week : null,
                  main: row.mainName && row.mainStatus ? { fileName: row.mainName, status: row.mainStatus } : null,
                  parts: row.parts,
                  sentAt: row.sentAt,
                }
              : null,
        }));
        const choices = await tagChoices(tx, "show");
        const { photoId: _photo, ...artistView } = who;
        return { artist: artistView, cycle, blocks, items, choices };
      }),

    /** Un show à remplir ou à corriger, s'il appartient à l'artiste du lien ; null sinon. */
    fiche: (jeton: string, showId: string): Promise<EnvoiFiche | null> =>
      db.transaction(async (tx) => {
        const who = await linkOf(tx, jeton);
        if (!who || !(await editable(tx, who.id, showId))) return null;
        const current = await getShow(tx, showId);
        if (!current) return null;
        const [sent] = await tx.select({ note: submission.note, link: submission.link, blockStart: submission.blockStart, week: submission.week }).from(submission).where(eq(submission.showId, showId)).limit(1);
        const main = await mainOf(tx, showId);
        const parts = await tx
          .select({ id: audioFile.id, position: audioFile.position, artist: audioFile.trackArtist, title: audioFile.trackTitle, durationSeconds: audioFile.durationSeconds, fileName: audioFile.fileName, sizeBytes: audioFile.sizeBytes })
          .from(audioFile)
          .where(and(eq(audioFile.showId, showId), eq(audioFile.role, "part"), eq(audioFile.status, "received")))
          .orderBy(asc(audioFile.position));
        return {
          showId,
          version: current.version,
          title: current.title,
          type: current.type,
          broadcastAt: current.broadcastAt,
          slot: current.radiocultEventId !== null,
          description: current.description ?? "",
          energy: clampEnergy(current.energy),
          tags: current.tags.map((one) => one.id),
          tracks: formOfShow(current).tracks,
          cover: current.cover,
          note: sent?.note ?? "",
          link: sent?.link ?? "",
          blockStart: sent?.blockStart ?? null,
          week: sent?.week === 1 || sent?.week === 2 ? sent.week : null,
          main: main ? { fileName: main.fileName, status: main.status, sizeBytes: main.sizeBytes } : null,
          parts: parts.map((part) => ({ ...part, position: part.position ?? 0, artist: part.artist ?? "", title: part.title ?? "" })),
        };
      }),

    /**
     * Un fichier qui va partir vers le seau : sa ligne « uploading » et sa clé. Le serveur signe ensuite l'adresse
     * d'envoi pour cette seule clé. Ou la raison du refus.
     */
    preparerFichier: (jeton: string, ask: { showId?: string; role: AudioRole; fileName: string; size: number }): Promise<{ ok: true; id: string; key: string; mime: string } | { ok: false; error: string }> =>
      db.transaction(async (tx) => {
        const now = clock();
        const who = await linkOf(tx, jeton);
        if (!who) return { ok: false, error: "Ce lien ne marche plus : demande-en un nouveau à l'équipe." };
        if (ask.role !== "main" && ask.role !== "part") return { ok: false, error: "Ce fichier n'a pas de place ici." };
        const refused = audioRefusal(ask.fileName, ask.size, ask.role);
        if (refused) return { ok: false, error: refused };
        if (ask.showId && !(await editable(tx, who.id, ask.showId))) return { ok: false, error: "Cette émission n'est plus modifiable : elle est peut-être déjà partie." };
        const [pending] = await tx
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(audioFile)
          .where(and(eq(audioFile.artistId, who.id), eq(audioFile.status, "uploading"), gte(audioFile.createdAt, new Date(now.getTime() - STALE_UPLOAD_MS))));
        if ((pending?.n ?? 0) >= MAX_PENDING) return { ok: false, error: "Trop d'envois en cours : termine ceux-là, ou réessaie demain." };
        const type = audioTypeOf(ask.fileName, ask.role)!;
        const id = randomUUID();
        const key = audioKey(id, type.ext, now);
        await tx.insert(audioFile).values({ id, artistId: who.id, role: ask.role, key, fileName: clean(ask.fileName).slice(0, 200) || `son.${type.ext}`, mimeType: type.mime, status: "uploading" });
        return { ok: true, id, key, mime: type.mime };
      }),

    /** Les fichiers en cours d'envoi de ce lien, parmi ceux-là : leur clé, pour vérifier dans le seau qu'ils sont arrivés. */
    enAttente: (jeton: string, ids: string[]): Promise<{ id: string; key: string; role: AudioRole }[]> =>
      db.transaction(async (tx) => {
        const who = await linkOf(tx, jeton);
        const wanted = [...new Set(ids.filter(isUuid))];
        if (!who || !wanted.length) return [];
        return tx
          .select({ id: audioFile.id, key: audioFile.key, role: audioFile.role })
          .from(audioFile)
          .where(and(inArray(audioFile.id, wanted), eq(audioFile.artistId, who.id), eq(audioFile.status, "uploading")));
      }),

    /**
     * Enregistre une émission : sa fiche (le show reste en brouillon), l'envoi, et les fichiers arrivés dans le seau,
     * avec leur taille réelle (`arrived`, lue dans le seau par le serveur). Un nouveau son remplace l'ancien ; les
     * morceaux suivent la liste envoyée. Rend les clés des fichiers remplacés, et les images à retirer.
     */
    deposer: (jeton: string, form: EnvoiForm, arrived: Map<string, number>): Promise<Deposited | NotSaved> =>
      db.transaction(async (tx) => {
        const who = await linkOf(tx, jeton);
        if (!who) return { ok: false, errors: { form: "Ce lien ne marche plus : demande-en un nouveau à l'équipe." } };
        const errors: FieldErrors = {};
        let current: AdminShow | null = null;
        if (form.showId) {
          if (!(await editable(tx, who.id, form.showId))) return { ok: false, errors: { form: "Cette émission n'est plus modifiable : elle est peut-être déjà partie, ou a été retirée." } };
          current = await getShow(tx, form.showId);
          if (!current) return { ok: false, errors: { form: "Cette émission n'existe plus." } };
        }
        const [previous] = current ? await tx.select({ blockStart: submission.blockStart, week: submission.week }).from(submission).where(eq(submission.showId, current.id)).limit(1) : [];

        // Le type et le bloc d'un nouvel envoi.
        const type = current?.type ?? (showType.enumValues as readonly string[]).find((one) => one === form.type);
        if (!type) errors.type = "Choisis DJ set, podcast ou playlist.";
        let blockStart = previous?.blockStart ?? null;
        if (!current || (current.radiocultEventId === null && clean(form.blockStart))) {
          const cycle = await readCycle(tx);
          const offered = who.group && cycle ? proposedBlocks(who.group, cycle, clock()).map((one) => one.block.start) : [];
          if (offered.length) {
            blockStart = clean(form.blockStart) || null;
            if (!blockStart || !offered.includes(blockStart)) errors.blockStart = "Choisis le bloc de ton passage.";
          }
        }
        const week = clean(form.week);
        if (week && week !== "1" && week !== "2") errors.week = "Choisis la première ou la seconde semaine.";

        // La fiche, vérifiée comme dans l'admin : seulement des étiquettes existantes, ses artistes gardés.
        const base = current ? formOfShow(current) : { ...emptyShowForm(), type: type ?? "" };
        const tags = form.tags.filter(isUuid);
        if (tags.length !== form.tags.length) errors.tags = "Choisis tes étiquettes dans les listes.";
        const artistIds = current ? current.artists.map((one) => one.id) : [];
        if (!artistIds.includes(who.id)) artistIds.push(who.id);
        const read = readShowForm({ ...base, title: form.title, description: form.description, energy: form.energy, tags, tracks: form.tracks, pasted: form.pasted, artists: artistIds });
        Object.assign(errors, read.errors);
        const known = tags.length ? (await tx.select({ id: tag.id }).from(tag).where(inArray(tag.id, tags))).length : 0;
        if (known !== tags.length) errors.tags = "Une de ces étiquettes n'existe plus : recharge la page.";
        const note = (form.note ?? "").replace(/\r\n?/g, "\n").trim();
        if (note.length > 2000) errors.note = "2000 caractères au plus.";
        const link = clean(form.link);
        if (link && (link.length > LIMITS.url || !/^https:\/\/\S+$/.test(link))) errors.link = "Un lien qui commence par https://.";

        // Les fichiers : le son, et les morceaux, arrivés en entier dans le seau.
        const main = form.main ? await tx.select().from(audioFile).where(and(eq(audioFile.id, form.main), eq(audioFile.artistId, who.id), eq(audioFile.role, "main"), eq(audioFile.status, "uploading"))).limit(1).then((rows) => rows[0]) : undefined;
        if (form.main && (!main || !arrived.get(form.main))) errors.main = "Ton fichier n'est pas arrivé en entier : renvoie-le.";
        else if (main && arrived.get(main.id)! > MAX_MAIN_BYTES) errors.main = `Ton fichier dépasse ${MAX_MAIN_BYTES / 1_000_000} Mo.`;
        const before = current ? await mainOf(tx, current.id) : null;
        const knownParts = current ? await tx.select({ id: audioFile.id, sizeBytes: audioFile.sizeBytes }).from(audioFile).where(and(eq(audioFile.showId, current.id), eq(audioFile.role, "part"))) : [];
        const wantedParts = form.parts.filter((part) => isUuid(part.id));
        const fresh = wantedParts.filter((part) => !knownParts.some((one) => one.id === part.id)).map((part) => part.id);
        const freshRows = fresh.length ? await tx.select({ id: audioFile.id }).from(audioFile).where(and(inArray(audioFile.id, fresh), eq(audioFile.artistId, who.id), eq(audioFile.role, "part"), eq(audioFile.status, "uploading"))) : [];
        if (freshRows.length !== fresh.length || fresh.some((id) => !arrived.get(id))) errors.parts = "Un morceau n'est pas arrivé en entier : renvoie-le.";
        else if (fresh.some((id) => arrived.get(id)! > MAX_PART_BYTES)) errors.parts = `Un morceau dépasse ${MAX_PART_BYTES / 1_000_000} Mo.`;
        if (wantedParts.length > MAX_PARTS) errors.parts = `${MAX_PARTS} morceaux au plus.`;
        const total = wantedParts.reduce((sum, part) => sum + (arrived.get(part.id) ?? knownParts.find((one) => one.id === part.id)?.sizeBytes ?? 0), 0);
        if (total > MAX_PLAYLIST_BYTES) errors.parts = `Une playlist pèse ${MAX_PLAYLIST_BYTES / 1_000_000_000} Go au plus.`;
        if (type === "playlist") {
          if (!wantedParts.length && !link && !before && !main) errors.parts = "Ajoute tes morceaux, ou le lien de ta playlist.";
        } else if (type && !main && !before) errors.main = "Ajoute ton fichier MP3.";
        // La pochette : une image envoyée à l'instant, « none » pour retirer celle du show, rien pour la garder.
        if (form.cover && form.cover !== "none" && !isUuid(form.cover)) errors.cover = "Cette image n'existe plus : envoie-la de nouveau.";

        if (Object.keys(errors).length) return { ok: false, errors };

        const saved = await saveShow(tx, { id: current?.id, version: clean(form.version) || undefined, values: read.values });
        if (!saved.ok) return saved;
        const showId = saved.id;
        await tx
          .insert(submission)
          .values({ showId, artistId: who.id, link: link || null, note: note || null, blockStart, week: week ? Number(week) : null })
          .onConflictDoUpdate({ target: submission.showId, set: { artistId: who.id, link: link || null, note: note || null, blockStart, week: week ? Number(week) : null } });

        const removedKeys: string[] = [];
        if (main) {
          if (before) {
            await tx.delete(audioFile).where(eq(audioFile.id, before.id));
            removedKeys.push(before.key);
          }
          await tx.update(audioFile).set({ showId, sizeBytes: arrived.get(main.id)!, status: "received" }).where(eq(audioFile.id, main.id));
        }
        const keep = new Set(wantedParts.map((part) => part.id));
        const dropped = knownParts.filter((one) => !keep.has(one.id)).map((one) => one.id);
        if (dropped.length) removedKeys.push(...(await tx.delete(audioFile).where(inArray(audioFile.id, dropped)).returning({ key: audioFile.key })).map((row) => row.key));
        for (const [index, part] of wantedParts.entries()) {
          const duration = Number(part.duration);
          await tx
            .update(audioFile)
            .set({
              showId,
              position: index + 1,
              trackArtist: clean(part.artist).slice(0, LIMITS.track) || null,
              trackTitle: clean(part.title).slice(0, LIMITS.track) || null,
              durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
              status: "received",
              ...(arrived.get(part.id) ? { sizeBytes: arrived.get(part.id)! } : {}),
            })
            .where(eq(audioFile.id, part.id));
        }

        const removedImages: string[] = [];
        if (form.cover) {
          const placed = await placeMedia(tx, "cover", { id: showId, mediaId: form.cover === "none" ? null : form.cover });
          if (!placed.ok) return placed;
          removedImages.push(...(await releaseMedia(tx, [placed.previous])));
        }
        return { ok: true, showId, removedKeys, removedImages };
      }),

    /** Inscrit une image envoyée par l'artiste (une pochette, une photo) : ses versions sont déjà sur le Storage. */
    ajouterImage: (jeton: string, file: MediaUpload): Promise<{ ok: true; media: AdminMedia } | NotSaved> =>
      db.transaction(async (tx) => {
        const who = await linkOf(tx, jeton);
        if (!who) return { ok: false, errors: { form: "Ce lien ne marche plus : demande-en un nouveau à l'équipe." } };
        return addMedia(tx, file);
      }),

    /** Retire une image inscrite à l'instant et jamais posée. Rend les clés à effacer du Storage. */
    abandonnerImage: (jeton: string, mediaId: string): Promise<string[]> =>
      db.transaction(async (tx) => ((await linkOf(tx, jeton)) ? releaseMedia(tx, [mediaId]) : [])),

    /** Met à jour la bio et la photo de l'artiste du lien. Rend les images à retirer. */
    majFiche: (jeton: string, change: { bio?: string; photo?: string | null; photoText?: MediaText }): Promise<{ ok: true; removedImages: string[] } | NotSaved> =>
      db.transaction(async (tx) => {
        const who = await linkOf(tx, jeton);
        if (!who) return { ok: false, errors: { form: "Ce lien ne marche plus : demande-en un nouveau à l'équipe." } };
        const removedImages: string[] = [];
        if (change.bio !== undefined) {
          const bio = change.bio.replace(/\r\n?/g, "\n").trim();
          if (bio.length > LIMITS.text) return { ok: false, errors: { bio: `${LIMITS.text} caractères au plus.` } };
          await tx.update(artist).set({ bio: bio || null }).where(eq(artist.id, who.id));
        }
        if (change.photo !== undefined) {
          if (change.photo !== null && !isUuid(change.photo)) return { ok: false, errors: { photo: "Cette image n'existe plus : envoie-la de nouveau." } };
          const placed = await placeMedia(tx, "photo", { id: who.id, mediaId: change.photo });
          if (!placed.ok) return placed;
          removedImages.push(...(await releaseMedia(tx, [placed.previous])));
        }
        await tx.update(uploadLink).set({ profileUpdatedAt: clock() }).where(eq(uploadLink.artistId, who.id));
        return { ok: true, removedImages };
      }),

    /**
     * Le ménage de la tâche de nuit : les fichiers jamais arrivés (en cours d'envoi depuis plus d'un jour) sont oubliés,
     * et un envoi vers SoundCloud bloqué depuis plus de 15 minutes passe en échec. Rend les clés à effacer du seau.
     */
    menage: (): Promise<{ keys: string[]; stuck: number }> =>
      db.transaction(async (tx) => {
        const now = clock();
        const stale = await tx
          .delete(audioFile)
          .where(and(eq(audioFile.status, "uploading"), lt(audioFile.createdAt, new Date(now.getTime() - STALE_UPLOAD_MS))))
          .returning({ key: audioFile.key });
        const stuck = await tx
          .update(audioFile)
          .set({ status: "failed", error: "L'envoi vers SoundCloud s'est interrompu. Réessaie avec « Publier maintenant »." })
          .where(and(eq(audioFile.status, "sending"), lt(audioFile.updatedAt, new Date(now.getTime() - STUCK_SENDING_MS))))
          .returning({ id: audioFile.id });
        return { keys: stale.map((row) => row.key), stuck: stuck.length };
      }),
  };
}

export type Envois = ReturnType<typeof createEnvois>;
