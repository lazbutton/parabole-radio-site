/** La page À propos pour le site : ses panneaux, et le film qu'on y lance. */
import type { Tx } from "../access.ts";
import { aboutPage, type AboutCredit, type ArtistLink } from "../schema.ts";

/** Le film de la page : la vidéo, son image fixe, son titre (dit aux lecteurs d'écran), son cadre et sa durée. */
export type AboutFilm = { src: string; type: string; poster: string | null; title: string; width: number | null; height: number | null; durationSeconds: number | null };

/** La description et le texte de CANDIDATER sont en Markdown, à rendre sans HTML brut. */
export type AboutContent = {
  description: string;
  socials: ArtistLink[];
  team: AboutCredit[];
  credits: AboutCredit[];
  contactEmail: string | null;
  apply: { text: string; url: string | null; label: string };
  film: AboutFilm | null;
  updatedAt: Date;
};

/** La page À propos. Null si sa ligne manque (migration pas appliquée). */
export async function getAbout(tx: Tx): Promise<AboutContent | null> {
  const [row] = await tx.select().from(aboutPage).limit(1);
  if (!row) return null;
  return {
    description: row.description,
    socials: row.socials,
    team: row.team,
    credits: row.credits,
    contactEmail: row.contactEmail,
    apply: { text: row.applyText, url: row.applyUrl, label: row.applyLabel },
    film:
      row.filmUrl && row.filmMimeType
        ? {
            src: row.filmUrl,
            type: row.filmMimeType,
            poster: row.filmPosterUrl,
            title: row.filmTitle,
            width: row.filmWidth,
            height: row.filmHeight,
            durationSeconds: row.filmDurationSeconds,
          }
        : null,
    updatedAt: row.updatedAt,
  };
}
