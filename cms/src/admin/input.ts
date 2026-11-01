/**
 * Les saisies des écrans d'admin, vérifiées avant d'écrire : ce que l'écran envoie (du texte), ce qu'on en tire pour
 * la base, et un message par champ fautif. La base vérifie encore derrière (contraintes, src/admin/errors.ts) : deux
 * barrières plutôt qu'une. Les messages tutoient, comme le reste de l'admin.
 */
import { fromParisInput } from "../paris.ts";
import { artistRole, showType, tagKind, type ArtistLink, type ArtistRole, type ShowType, type TagKind } from "../schema.ts";
import { slugify } from "../slug.ts";
import { parseTimecode, parseTracklist, type TrackLine } from "../tracklist.ts";

/** Un message par champ fautif : « title », « tracks.2.start », « links.0.url »… « form » vaut pour toute la fiche. */
export type FieldErrors = Record<string, string>;

/** Un artiste choisi dans la liste (son identifiant), ou un nom nouveau : il sera créé, en brouillon. */
export type ArtistPick = { id: string } | { name: string };
/** Une étiquette choisie dans la liste, ou une nouvelle, créée à la volée. */
export type TagPick = { id: string } | { kind: TagKind; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Le préfixe d'un choix nouveau dans les listes de l'écran : « nouveau:Nom », « nouveau:genre:Nom ». */
export const NEW_PICK = "nouveau:";

export const LIMITS = { title: 200, name: 200, text: 20_000, tag: 60, track: 300, tracks: 300, picks: 30, links: 20, label: 60, url: 500 };

const oneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);
const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const longText = (text: string | undefined) => (text ?? "").replace(/\r\n?/g, "\n").trim();

function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Une adresse collée sans son début (« instagram.com/… », « www.site.fr ») reçoit « https:// ». */
export const withScheme = (text: string): string =>
  text && !/^[a-z][a-z0-9+.-]*:/i.test(text) && /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/.test(text) ? `https://${text}` : text;

/** L'adresse d'un contenu : celle qu'on a tapée, mise au bon format, ou à défaut celle du titre. */
function readSlug(typed: string, fallback: string, errors: FieldErrors): { slug: string; slugFromTitle: boolean } {
  const slug = slugify(typed || fallback);
  if (!slug && (typed || fallback)) errors.slug = "Ajoute au moins une lettre ou un chiffre.";
  return { slug, slugFromTitle: !typed };
}

// ---------------------------------------------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------------------------------------------

/** La fiche d'un show telle que l'écran l'envoie. */
export type ShowForm = {
  title: string;
  slug: string;
  type: string;
  /** Date et heure de diffusion à Paris, au format d'un champ datetime-local : « 2026-06-13T18:00 ». */
  broadcastAt: string;
  /** « h:mm:ss » ou « m:ss ». */
  duration: string;
  description: string;
  soundcloudUrl: string;
  soundcloudTrackId: string;
  /** Dans l'ordre d'affichage : un identifiant, ou « nouveau:Nom ». */
  artists: string[];
  /** Un identifiant, ou « nouveau:genre:Nom ». */
  tags: string[];
  tracks: TrackLine[];
  /** Une tracklist collée en texte, à ajouter à la fin (quand le navigateur ne l'a pas déjà fait). */
  pasted: string;
};

export type ShowValues = {
  title: string;
  slug: string;
  /** Le slug vient du titre : déjà pris, il reçoit un numéro plutôt qu'un refus. */
  slugFromTitle: boolean;
  type: ShowType;
  broadcastAt: Date | null;
  durationSeconds: number | null;
  description: string | null;
  soundcloudUrl: string | null;
  soundcloudTrackId: string | null;
  artists: ArtistPick[];
  tags: TagPick[];
  tracks: { artist: string; title: string; startSeconds: number | null; hopperUrl: string | null }[];
};

export const emptyShowForm = (): ShowForm => ({
  title: "",
  slug: "",
  type: "",
  broadcastAt: "",
  duration: "",
  description: "",
  soundcloudUrl: "",
  soundcloudTrackId: "",
  artists: [],
  tags: [],
  tracks: [],
  pasted: "",
});

/** Les morceaux de la fiche, la tracklist collée ajoutée à la fin, sans les lignes vides. */
export function mergeTracks(form: Pick<ShowForm, "tracks" | "pasted">): TrackLine[] {
  const typed = form.tracks.map((line) => ({ artist: clean(line.artist), title: clean(line.title), start: clean(line.start), hopperUrl: withScheme(clean(line.hopperUrl)) }));
  const pasted = parseTracklist(form.pasted ?? "").map((line) => ({ ...line, hopperUrl: withScheme(line.hopperUrl) }));
  return [...typed, ...pasted].filter((line) => line.artist || line.title || line.start || line.hopperUrl);
}

function readArtistPick(value: string): ArtistPick | null {
  if (UUID.test(value)) return { id: value.toLowerCase() };
  if (!value.startsWith(NEW_PICK)) return null;
  const name = clean(value.slice(NEW_PICK.length)).slice(0, LIMITS.name);
  return name ? { name } : null;
}

function readTagPick(value: string): TagPick | null {
  if (UUID.test(value)) return { id: value.toLowerCase() };
  if (!value.startsWith(NEW_PICK)) return null;
  const [kind = "", ...rest] = value.slice(NEW_PICK.length).split(":");
  const name = clean(rest.join(":")).slice(0, LIMITS.tag);
  return oneOf(tagKind.enumValues, kind) && name ? { kind, name } : null;
}

/** Un même artiste ou une même étiquette choisis deux fois ne comptent qu'une fois. */
function unique<T extends ArtistPick | TagPick>(picks: T[]): T[] {
  const seen = new Set<string>();
  return picks.filter((pick) => {
    const key = "id" in pick ? pick.id : `${"kind" in pick ? pick.kind : ""}:${slugify(pick.name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Vérifie la fiche d'un show. Rend la fiche remise au propre (tracklist collée ajoutée, lignes vides retirées), à
 * réafficher en cas d'erreur, les valeurs pour la base, et les erreurs par champ. `publish` : la fiche va être
 * publiée, il lui faut une date de diffusion.
 */
export function readShowForm(input: ShowForm, { publish = false } = {}): { form: ShowForm; values: ShowValues; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const form: ShowForm = { ...input, soundcloudUrl: withScheme(clean(input.soundcloudUrl)), tracks: mergeTracks(input), pasted: "" };

  const title = clean(form.title);
  if (!title) errors.title = "Le titre est obligatoire.";
  else if (title.length > LIMITS.title) errors.title = `${LIMITS.title} caractères au plus.`;
  const { slug, slugFromTitle } = readSlug(clean(form.slug), title, errors);

  const type = clean(form.type);
  if (!oneOf(showType.enumValues, type)) errors.type = "Choisis un type.";

  let broadcastAt: Date | null = null;
  if (clean(form.broadcastAt)) {
    broadcastAt = fromParisInput(clean(form.broadcastAt));
    if (!broadcastAt) errors.broadcastAt = "Cette date n'existe pas.";
  } else if (publish) errors.broadcastAt = "Il faut une date de diffusion pour publier.";

  let durationSeconds: number | null = null;
  if (clean(form.duration)) {
    durationSeconds = parseTimecode(form.duration);
    if (!durationSeconds) errors.duration = "Au format h:mm:ss, par exemple 2:00:00.";
  }

  const description = longText(form.description);
  if (description.length > LIMITS.text) errors.description = `${LIMITS.text} caractères au plus.`;

  const soundcloudUrl = clean(form.soundcloudUrl);
  if (soundcloudUrl && !/^https:\/\/([a-z]+\.)?soundcloud\.com\/\S+$/.test(soundcloudUrl)) errors.soundcloudUrl = "L'adresse de la piste commence par https://soundcloud.com/.";
  const soundcloudTrackId = clean(form.soundcloudTrackId);
  if (soundcloudTrackId && !/^[0-9]{1,20}$/.test(soundcloudTrackId)) errors.soundcloudTrackId = "Des chiffres seulement.";

  const artists = unique(form.artists.map(readArtistPick).filter((pick) => pick !== null));
  if (artists.length > LIMITS.picks) errors.artists = `${LIMITS.picks} artistes au plus.`;
  const tags = unique(form.tags.map(readTagPick).filter((pick) => pick !== null));
  if (tags.length > LIMITS.picks) errors.tags = `${LIMITS.picks} étiquettes au plus.`;
  for (const pick of tags) if ("name" in pick && !slugify(pick.name)) errors.tags = `« ${pick.name} » : ajoute au moins une lettre ou un chiffre.`;

  if (form.tracks.length > LIMITS.tracks) errors.tracks = `${LIMITS.tracks} morceaux au plus.`;
  const tracks = form.tracks.map((line, index) => {
    const at = (field: string) => `tracks.${index}.${field}`;
    if (!line.artist) errors[at("artist")] = "L'artiste manque.";
    else if (line.artist.length > LIMITS.track) errors[at("artist")] = `${LIMITS.track} caractères au plus.`;
    if (!line.title) errors[at("title")] = "Le titre manque.";
    else if (line.title.length > LIMITS.track) errors[at("title")] = `${LIMITS.track} caractères au plus.`;
    const startSeconds = line.start ? parseTimecode(line.start) : null;
    if (line.start && startSeconds === null) errors[at("start")] = "Minutage au format m:ss ou h:mm:ss.";
    if (line.hopperUrl && !/^https:\/\/hppr\.fr\/\S+$/.test(line.hopperUrl)) errors[at("hopperUrl")] = "Un lien Hopper commence par https://hppr.fr/.";
    return { artist: line.artist, title: line.title, startSeconds, hopperUrl: line.hopperUrl || null };
  });

  return {
    form,
    errors,
    values: {
      title,
      slug,
      slugFromTitle,
      type: type as ShowType,
      broadcastAt,
      durationSeconds,
      description: description || null,
      soundcloudUrl: soundcloudUrl || null,
      soundcloudTrackId: soundcloudTrackId || null,
      artists,
      tags,
      tracks,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Artistes
// ---------------------------------------------------------------------------------------------------------------

/** La fiche d'un artiste telle que l'écran l'envoie. */
export type ArtistForm = {
  name: string;
  slug: string;
  role: string;
  bio: string;
  /** Dans l'ordre d'affichage. */
  links: ArtistLink[];
};

export type ArtistValues = {
  name: string;
  slug: string;
  slugFromTitle: boolean;
  role: ArtistRole;
  bio: string | null;
  links: ArtistLink[];
};

export const emptyArtistForm = (): ArtistForm => ({ name: "", slug: "", role: "guest", bio: "", links: [] });

/** Les noms des sites les plus courants, pour un lien saisi sans libellé. */
const KNOWN_SITES: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)soundcloud\.com$/, "SoundCloud"],
  [/(^|\.)bandcamp\.com$/, "Bandcamp"],
  [/(^|\.)mixcloud\.com$/, "Mixcloud"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)spotify\.com$/, "Spotify"],
  [/(^|\.)(x|twitter)\.com$/, "X"],
  [/(^|\.)linktr\.ee$/, "Linktree"],
  [/(^|\.)resident-advisor\.net$|(^|\.)ra\.co$/, "Resident Advisor"],
];

/** Le libellé d'un lien saisi sans libellé : le nom du site. */
export function linkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return KNOWN_SITES.find(([pattern]) => pattern.test(host))?.[1] ?? host;
  } catch {
    return "";
  }
}

/** Vérifie la fiche d'un artiste : la fiche remise au propre, les valeurs pour la base, les erreurs par champ. */
export function readArtistForm(input: ArtistForm): { form: ArtistForm; values: ArtistValues; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const links = input.links.map((link) => ({ label: clean(link.label), url: withScheme(clean(link.url)) })).filter((link) => link.label || link.url);
  const form: ArtistForm = { ...input, links };

  const name = clean(form.name);
  if (!name) errors.name = "Le nom est obligatoire.";
  else if (name.length > LIMITS.name) errors.name = `${LIMITS.name} caractères au plus.`;
  const { slug, slugFromTitle } = readSlug(clean(form.slug), name, errors);

  const role = clean(form.role);
  if (!oneOf(artistRole.enumValues, role)) errors.role = "Choisis résident ou invité.";

  const bio = longText(form.bio);
  if (bio.length > LIMITS.text) errors.bio = `${LIMITS.text} caractères au plus.`;

  if (links.length > LIMITS.links) errors.links = `${LIMITS.links} liens au plus.`;
  const values: ArtistLink[] = links.map((link, index) => {
    if (!link.url) errors[`links.${index}.url`] = "L'adresse manque.";
    else if (link.url.length > LIMITS.url || !isWebAddress(link.url)) errors[`links.${index}.url`] = "Une adresse complète : https://…";
    if (link.label.length > LIMITS.label) errors[`links.${index}.label`] = `${LIMITS.label} caractères au plus.`;
    return { label: link.label || linkLabel(link.url), url: link.url };
  });

  return { form, errors, values: { name, slug, slugFromTitle, role: role as ArtistRole, bio: bio || null, links: values } };
}

// ---------------------------------------------------------------------------------------------------------------
// Vidéos de fond
// ---------------------------------------------------------------------------------------------------------------

/** Les vidéos que le fond sait passer dans tous les navigateurs. */
export const CLIP_TYPES = ["video/mp4", "video/webm"] as const;
export type ClipType = (typeof CLIP_TYPES)[number];

/**
 * Le fichier d'un clip tel que l'écran l'envoie, une fois la vidéo et son image d'attente déposées sur le stockage :
 * leurs adresses, et ce que le navigateur a lu de la vidéo (taille en octets, durée en secondes, dimensions en pixels).
 */
export type ClipFileForm = { videoUrl: string; posterUrl: string; mimeType: string; size: string; duration: string; width: string; height: string };

export type ClipFile = {
  videoUrl: string;
  posterUrl: string | null;
  mimeType: ClipType;
  sizeBytes: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

/** Une adresse de fichier : https://… (Vercel Blob), ou un chemin du site (« /PARABOLE RADIO/… »). */
function isFileAddress(text: string): boolean {
  if (text.length > LIMITS.url) return false;
  if (/^\/[^/]/.test(text)) return true;
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/** Un nombre positif lu dans un champ, arrondi à l'unité (1 au moins) ; null s'il manque ou ne veut rien dire. */
function positive(text: string): number | null {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
}

/** Le titre d'un clip : une ligne, vide permis (le site montre alors son numéro seul). */
export function readClipTitle(text: string): { title: string; errors: FieldErrors } {
  const title = clean(text);
  return { title, errors: title.length > LIMITS.title ? { title: `${LIMITS.title} caractères au plus.` } : {} };
}

/** Vérifie le fichier d'un clip : les valeurs pour la base, les erreurs par champ (« video » pour le fichier). */
export function readClipFile(input: ClipFileForm): { values: ClipFile; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const videoUrl = clean(input.videoUrl);
  const posterUrl = clean(input.posterUrl);
  const mimeType = clean(input.mimeType);
  if (!isFileAddress(videoUrl)) errors.video = "L'adresse de la vidéo manque ou n'est pas valable.";
  else if (posterUrl && !isFileAddress(posterUrl)) errors.video = "L'adresse de l'image d'attente n'est pas valable.";
  else if (!oneOf(CLIP_TYPES, mimeType)) errors.video = "Une vidéo MP4 ou WebM seulement.";
  let width = positive(input.width);
  let height = positive(input.height);
  // L'une sans l'autre ne dit rien du cadre.
  if (width === null || height === null) width = height = null;
  return {
    errors,
    values: {
      videoUrl,
      posterUrl: posterUrl || null,
      mimeType: mimeType as ClipType,
      sizeBytes: positive(input.size),
      durationSeconds: positive(input.duration),
      width,
      height,
    },
  };
}
