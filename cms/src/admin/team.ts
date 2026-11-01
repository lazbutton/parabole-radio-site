/**
 * La personne connectée et le tableau de bord de l'admin.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { artist, member, show, type TeamRole } from "../schema.ts";

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
};

const counts = (status: typeof show.status | typeof artist.status) => ({
  draft: sql<number>`count(*) filter (where ${status} = 'draft')`.mapWith(Number),
  published: sql<number>`count(*) filter (where ${status} = 'published')`.mapWith(Number),
});

/** Le tableau de bord : combien de shows et d'artistes, et les derniers brouillons. */
export async function overview(tx: Tx, { drafts = 8 } = {}): Promise<Overview> {
  const [shows] = await tx.select(counts(show.status)).from(show);
  const [artists] = await tx.select(counts(artist.status)).from(artist);
  const showDrafts = await tx.select({ id: show.id, title: show.title, updatedAt: show.updatedAt }).from(show).where(eq(show.status, "draft")).orderBy(desc(show.updatedAt)).limit(drafts);
  const artistDrafts = await tx.select({ id: artist.id, title: artist.name, updatedAt: artist.updatedAt }).from(artist).where(eq(artist.status, "draft")).orderBy(desc(artist.updatedAt)).limit(drafts);
  return {
    shows: shows ?? { draft: 0, published: 0 },
    artists: artists ?? { draft: 0, published: 0 },
    drafts: [...showDrafts.map((row) => ({ kind: "show" as const, ...row })), ...artistDrafts.map((row) => ({ kind: "artist" as const, ...row }))]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, drafts),
  };
}
