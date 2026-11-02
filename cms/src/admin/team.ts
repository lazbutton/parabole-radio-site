/**
 * La personne connectée et le tableau de bord de l'admin.
 */
import { asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { outer } from "../read/common.ts";
import { artist, member, show, tag, tagGroup, tagMember, type ContentStatus, type ShowType, type TeamRole } from "../schema.ts";
import { lacksBio, lacksPhoto } from "./artists.ts";
import { artistNames, lacksSound, lacksTracklist } from "./shows.ts";

export type TeamMember = { userId: string; email: string; name: string; role: TeamRole };

/**
 * Sa fiche d'équipe, lue sous son propre rôle : la règle d'accès de « member » ne montre l'équipe qu'à ses membres.
 * Null pour un compte qui n'en fait pas partie.
 */
export async function getMember(tx: Tx, userId: string): Promise<TeamMember | null> {
  const [row] = await tx.select({ userId: member.userId, email: member.email, name: member.name, role: member.role }).from(member).where(eq(member.userId, userId)).limit(1);
  return row ?? null;
}

export type Overview = {
  shows: { draft: number; published: number };
  artists: { draft: number; published: number };
  /** Les brouillons modifiés le plus récemment, shows et artistes mêlés. */
  drafts: { kind: "show" | "artist"; id: string; title: string; updatedAt: Date }[];
  /** Les prochains shows à diffuser, du plus proche au plus lointain, brouillons compris. */
  upcoming: { id: string; title: string; type: ShowType; status: ContentStatus; broadcastAt: Date; artists: string[] }[];
  /**
   * Ce qui reste à compléter : shows déjà diffusés sans tracklist ou sans son, artistes sans photo ou sans bio,
   * étiquettes à classer (sans place dans les filtres). Les mêmes conditions que les listes où l'on arrive : le nombre
   * annoncé est celui de la liste.
   */
  missing: { tracklist: number; sound: number; photo: number; bio: number; tags: number };
};

const counts = (status: typeof show.status | typeof artist.status) => ({
  draft: sql<number>`count(*) filter (where ${status} = 'draft')`.mapWith(Number),
  published: sql<number>`count(*) filter (where ${status} = 'published')`.mapWith(Number),
});

/** Le tableau de bord : combien de shows et d'artistes, les prochaines diffusions, ce qui manque, les derniers brouillons. */
export async function overview(tx: Tx, { drafts = 8, upcoming = 5, now = new Date() }: { drafts?: number; upcoming?: number; now?: Date } = {}): Promise<Overview> {
  const [shows] = await tx
    .select({
      ...counts(show.status),
      tracklist: sql<number>`count(*) filter (where ${lacksTracklist(now)})`.mapWith(Number),
      sound: sql<number>`count(*) filter (where ${lacksSound(now)})`.mapWith(Number),
    })
    .from(show);
  const [artists] = await tx
    .select({
      ...counts(artist.status),
      photo: sql<number>`count(*) filter (where ${lacksPhoto()})`.mapWith(Number),
      bio: sql<number>`count(*) filter (where ${lacksBio()})`.mapWith(Number),
    })
    .from(artist);
  const [unplaced] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(tag)
    .where(sql`not exists (select 1 from ${tagGroup} g where g.tag_id = ${outer(tag.id)}) and not exists (select 1 from ${tagMember} m where m.tag_id = ${outer(tag.id)})`);
  const next = await tx
    .select({ id: show.id, title: show.title, type: show.type, status: show.status, broadcastAt: show.broadcastAt, artists: artistNames() })
    .from(show)
    .where(gt(show.broadcastAt, now))
    .orderBy(asc(show.broadcastAt))
    .limit(upcoming);
  const showDrafts = await tx.select({ id: show.id, title: show.title, updatedAt: show.updatedAt }).from(show).where(eq(show.status, "draft")).orderBy(desc(show.updatedAt)).limit(drafts);
  const artistDrafts = await tx.select({ id: artist.id, title: artist.name, updatedAt: artist.updatedAt }).from(artist).where(eq(artist.status, "draft")).orderBy(desc(artist.updatedAt)).limit(drafts);
  return {
    shows: { draft: shows?.draft ?? 0, published: shows?.published ?? 0 },
    artists: { draft: artists?.draft ?? 0, published: artists?.published ?? 0 },
    drafts: [...showDrafts.map((row) => ({ kind: "show" as const, ...row })), ...artistDrafts.map((row) => ({ kind: "artist" as const, ...row }))]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, drafts),
    // La condition de la requête écarte les shows sans date.
    upcoming: next.map((row) => ({ ...row, broadcastAt: row.broadcastAt as Date })),
    missing: { tracklist: shows?.tracklist ?? 0, sound: shows?.sound ?? 0, photo: artists?.photo ?? 0, bio: artists?.bio ?? 0, tags: unplaced?.n ?? 0 },
  };
}
