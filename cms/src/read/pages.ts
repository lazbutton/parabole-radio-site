/** Les pages simples pour le site : les mentions légales… (À propos a sa propre lecture, about.ts.) */
import { and, eq } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { page } from "../schema.ts";
import { isSlug } from "../slug.ts";

/** Le corps est en Markdown, à rendre sans HTML brut. */
export type PageContent = { slug: string; title: string; body: string; updatedAt: Date };

/** Une page publiée. Null si elle n'existe pas ou n'est pas publiée. */
export async function getPage(tx: Tx, slug: string): Promise<PageContent | null> {
  if (!isSlug(slug)) return null;
  const [row] = await tx
    .select({ slug: page.slug, title: page.title, body: page.body, updatedAt: page.updatedAt })
    .from(page)
    .where(and(eq(page.slug, slug), eq(page.status, "published")))
    .limit(1);
  return row ?? null;
}
