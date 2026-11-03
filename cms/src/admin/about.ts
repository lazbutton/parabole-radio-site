/**
 * La page À propos dans l'admin (cms/README.md, 9.10) : sa ligne unique et le corps des mentions légales (la page
 * « mentions-legales »), l'enregistrement des textes, et le film. Les fichiers du film ne passent jamais par ici,
 * seulement leurs adresses : le site Astro les dépose sur Vercel Blob, et efface ceux qu'un remplacement rend inutiles.
 * Sous le rôle de la personne connectée (src/admin/index.ts).
 */
import { eq } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { aboutPage, page, type AboutCredit, type ArtistLink } from "../schema.ts";
import { versionOf, type NotSaved } from "./common.ts";
import type { AboutValues, ClipFile } from "./input.ts";

/** L'adresse des mentions légales sur le site : /mentions-legales. */
export const LEGAL_SLUG = "mentions-legales";
const LEGAL_TITLE = "Mentions légales";

/** Le film de la page : sa vidéo, son image fixe, et ce que le navigateur en a lu à l'envoi. */
export type AdminFilm = Omit<ClipFile, "mimeType"> & { mimeType: string };

export type AdminAbout = {
  description: string;
  socials: ArtistLink[];
  team: AboutCredit[];
  credits: AboutCredit[];
  contactEmail: string | null;
  applyText: string;
  applyUrl: string | null;
  applyLabel: string;
  filmTitle: string;
  film: AdminFilm | null;
  /** Le corps des mentions légales, en Markdown ; vide si la page n'existe pas. */
  legal: string;
  updatedAt: Date;
  /** Jeton de version (src/admin/common.ts), à renvoyer avec la page. */
  version: string;
};

const missing: NotSaved = { ok: false, errors: { form: "La page À propos manque dans la base : la migration 0015_a_propos_acces n'y est pas appliquée." } };
const refused: NotSaved = { ok: false, errors: { form: "La base refuse cette écriture à ton compte. Il ne fait peut-être plus partie de l'équipe." } };

/**
 * La ligne de la page, verrouillée le temps de l'écrire, ou le refus à rendre : elle manque (migration pas appliquée),
 * ou le compte n'a pas le droit de la modifier (la règle d'écriture la lui cache alors).
 */
async function lockAbout(tx: Tx): Promise<{ version: string; videoUrl: string | null; posterUrl: string | null } | NotSaved> {
  const [row] = await tx
    .select({ version: versionOf(aboutPage.updatedAt), videoUrl: aboutPage.filmUrl, posterUrl: aboutPage.filmPosterUrl })
    .from(aboutPage)
    .for("update");
  if (row) return row;
  const [seen] = await tx.select({ id: aboutPage.id }).from(aboutPage).limit(1);
  return seen ? refused : missing;
}

const filmColumns = {
  videoUrl: aboutPage.filmUrl,
  posterUrl: aboutPage.filmPosterUrl,
  mimeType: aboutPage.filmMimeType,
  sizeBytes: aboutPage.filmSizeBytes,
  durationSeconds: aboutPage.filmDurationSeconds,
  width: aboutPage.filmWidth,
  height: aboutPage.filmHeight,
};

/** La page À propos, avec ses mentions légales. Null si sa ligne manque (migration pas appliquée). */
export async function getAbout(tx: Tx): Promise<AdminAbout | null> {
  const [row] = await tx
    .select({
      description: aboutPage.description,
      socials: aboutPage.socials,
      team: aboutPage.team,
      credits: aboutPage.credits,
      contactEmail: aboutPage.contactEmail,
      applyText: aboutPage.applyText,
      applyUrl: aboutPage.applyUrl,
      applyLabel: aboutPage.applyLabel,
      filmTitle: aboutPage.filmTitle,
      updatedAt: aboutPage.updatedAt,
      version: versionOf(aboutPage.updatedAt),
      ...filmColumns,
    })
    .from(aboutPage)
    .limit(1);
  if (!row) return null;
  const [legal] = await tx.select({ body: page.body }).from(page).where(eq(page.slug, LEGAL_SLUG)).limit(1);
  const { videoUrl, posterUrl, mimeType, sizeBytes, durationSeconds, width, height, ...fields } = row;
  const film = videoUrl && mimeType ? { videoUrl, posterUrl, mimeType, sizeBytes, durationSeconds, width, height } : null;
  return { ...fields, film, legal: legal?.body ?? "" };
}

export type AboutSave = {
  /** Le jeton de version lu à l'ouverture de la page. */
  version?: string;
  values: AboutValues;
};

/**
 * Enregistre les textes de la page, et les mentions légales s'ils ont changé (la page est créée au besoin, toujours
 * publiée : le site montre un texte d'attente quand son corps est vide). Le film ne bouge pas.
 */
export async function saveAbout(tx: Tx, { version, values }: AboutSave): Promise<{ ok: true } | NotSaved> {
  const current = await lockAbout(tx);
  if ("ok" in current) return current;
  if (version !== undefined && version !== current.version)
    return {
      ok: false,
      version: current.version,
      errors: { form: "Quelqu'un a enregistré la page pendant que tu la modifiais. Enregistre de nouveau pour remplacer sa version par la tienne." },
    };
  const { legal, ...fields } = values;
  await tx.update(aboutPage).set(fields).where(eq(aboutPage.id, true));
  const [notice] = await tx.select({ body: page.body, status: page.status }).from(page).where(eq(page.slug, LEGAL_SLUG)).for("update");
  if (!notice) await tx.insert(page).values({ slug: LEGAL_SLUG, title: LEGAL_TITLE, body: legal, status: "published" });
  else if (notice.body !== legal || notice.status !== "published") await tx.update(page).set({ body: legal, status: "published" }).where(eq(page.slug, LEGAL_SLUG));
  return { ok: true };
}

/** Ce que rend un changement du film : les adresses devenues inutiles, à effacer du stockage, et la nouvelle version. */
export type FilmPlaced = { ok: true; previous: string[]; version: string | null };

/**
 * Met un film sur la page (ses fichiers sont déjà sur le stockage), le remplace, ou l'enlève (null). Comme une photo
 * posée sur une fiche (src/admin/media.ts) : si l'écran avait la dernière version de la page, il reçoit la nouvelle ;
 * sinon `version` est null, et son prochain enregistrement signalera qu'on a modifié la page entre-temps.
 */
export async function setAboutFilm(tx: Tx, film: ClipFile | null, version?: string): Promise<FilmPlaced | NotSaved> {
  const current = await lockAbout(tx);
  if ("ok" in current) return current;
  const [updated] = await tx
    .update(aboutPage)
    .set({
      filmUrl: film?.videoUrl ?? null,
      filmPosterUrl: film?.posterUrl ?? null,
      filmMimeType: film?.mimeType ?? null,
      filmSizeBytes: film?.sizeBytes ?? null,
      filmDurationSeconds: film?.durationSeconds ?? null,
      filmWidth: film?.width ?? null,
      filmHeight: film?.height ?? null,
    })
    .where(eq(aboutPage.id, true))
    .returning({ version: versionOf(aboutPage.updatedAt) });
  const kept = new Set([film?.videoUrl, film?.posterUrl]);
  return {
    ok: true,
    previous: [current.videoUrl, current.posterUrl].filter((url): url is string => Boolean(url) && !kept.has(url!)),
    version: version !== undefined && version === current.version ? updated!.version : null,
  };
}

/** Change l'image fixe du film. Rend l'ancienne, à effacer du stockage. */
export async function setAboutPoster(tx: Tx, posterUrl: string, version?: string): Promise<FilmPlaced | NotSaved> {
  const current = await lockAbout(tx);
  if ("ok" in current) return current;
  if (!current.videoUrl) return { ok: false, errors: { film: "La page n'a plus de film : envoie d'abord la vidéo." } };
  const [updated] = await tx.update(aboutPage).set({ filmPosterUrl: posterUrl }).where(eq(aboutPage.id, true)).returning({ version: versionOf(aboutPage.updatedAt) });
  return {
    ok: true,
    previous: current.posterUrl && current.posterUrl !== posterUrl ? [current.posterUrl] : [],
    version: version !== undefined && version === current.version ? updated!.version : null,
  };
}
