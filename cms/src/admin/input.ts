/**
 * Les saisies des écrans d'admin, vérifiées avant d'écrire : ce que l'écran envoie (du texte), ce qu'on en tire pour
 * la base, et un message par champ fautif. La base vérifie encore derrière (contraintes, src/admin/errors.ts) : deux
 * barrières plutôt qu'une. Les messages tutoient, comme le reste de l'admin.
 */
import { ENERGY } from "../labels.ts";
import { fromParisInput } from "../paris.ts";
import { artistRole, facetScope, showType, type AboutCredit, type ArtistLink, type ArtistRole, type FacetScope, type ShowType } from "../schema.ts";
import { slugify } from "../slug.ts";
import { parseTimecode, parseTracklist, type TrackLine } from "../tracklist.ts";

/** Un message par champ fautif : « title », « tracks.2.start », « links.0.url »… « form » vaut pour toute la fiche. */
export type FieldErrors = Record<string, string>;

/** Un artiste choisi dans la liste (son identifiant), ou un nom nouveau : il sera créé, en brouillon. */
export type ArtistPick = { id: string } | { name: string };
/** Une étiquette choisie dans la liste, ou une nouvelle, créée à la volée (sans place : « à classer »). */
export type TagPick = { id: string } | { name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** Le préfixe d'un choix nouveau dans les listes de l'écran : « nouveau:Nom ». */
export const NEW_PICK = "nouveau:";

export const LIMITS = {
  title: 200,
  name: 200,
  text: 20_000,
  tag: 60,
  track: 300,
  tracks: 300,
  picks: 30,
  links: 20,
  label: 60,
  url: 500,
  /** Les étiquettes ajoutées d'un coup (une liste collée). */
  batch: 300,
  facet: 60,
  description: 500,
  /** Le texte alternatif d'une image : une phrase, pas une légende. */
  alt: 300,
  credit: 120,
  /** La légende d'une photo de la galerie d'un événement. */
  caption: 240,
  /** Les lignes de L'ÉQUIPE et des CRÉDITS de la page À propos, et chacun de leurs champs. */
  people: 60,
  person: 120,
  /** Le texte d'un bouton (CANDIDATER). */
  button: 40,
  email: 200,
};

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
  /** Le mood, de « 1 » (calme) à « 5 » (énergique) ; vide s'il n'est pas renseigné. Ignoré pour un podcast. */
  energy: string;
  description: string;
  soundcloudUrl: string;
  soundcloudTrackId: string;
  /** Dans l'ordre d'affichage : un identifiant, ou « nouveau:Nom ». */
  artists: string[];
  /** Un identifiant, ou « nouveau:Nom » (une étiquette créée sans place, à classer). */
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
  energy: number | null;
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
  energy: "",
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
  const name = tidyTagName(value.slice(NEW_PICK.length)).slice(0, LIMITS.tag);
  return name ? { name } : null;
}

/** Un même artiste ou une même étiquette choisis deux fois ne comptent qu'une fois. */
function unique<T extends ArtistPick | TagPick>(picks: T[]): T[] {
  const seen = new Set<string>();
  return picks.filter((pick) => {
    const key = "id" in pick ? pick.id : slugify(pick.name);
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

  // Le mood ne vaut que pour les DJ sets et les playlists : un podcast n'en garde pas.
  let energy: number | null = null;
  if (clean(form.energy) && type !== "podcast") {
    energy = Number(clean(form.energy));
    if (!Number.isInteger(energy) || energy < ENERGY.min || energy > ENERGY.max) {
      errors.energy = `Un cran de ${ENERGY.min} à ${ENERGY.max}.`;
      energy = null;
    }
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
      energy,
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
  /** Les identifiants de ses étiquettes (ce qu'il fait : podcast, playlist, DJ). */
  tags: string[];
  /** Son artiste chez Radio Cult, choisi dans la liste de la station ; vide : aucun ; absent : inchangé. */
  radiocultArtistId?: string;
};

export type ArtistValues = {
  name: string;
  slug: string;
  slugFromTitle: boolean;
  role: ArtistRole;
  bio: string | null;
  links: ArtistLink[];
  tags: string[];
  /** Null : relié à aucun ; absent : inchangé. */
  radiocultArtistId?: string | null;
};

export const emptyArtistForm = (): ArtistForm => ({ name: "", slug: "", role: "guest", bio: "", links: [], tags: [], radiocultArtistId: "" });

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

/** Des liens remis au propre, sans les lignes vides. */
const tidyLinks = (links: ArtistLink[]): ArtistLink[] =>
  links.map((link) => ({ label: clean(link.label), url: withScheme(clean(link.url)) })).filter((link) => link.label || link.url);

/** Vérifie des liens remis au propre : les valeurs pour la base (sans libellé, le nom du site), les erreurs sous `field`. */
function readLinks(links: ArtistLink[], field: string, errors: FieldErrors): ArtistLink[] {
  if (links.length > LIMITS.links) errors[field] = `${LIMITS.links} liens au plus.`;
  return links.map((link, index) => {
    if (!link.url) errors[`${field}.${index}.url`] = "L'adresse manque.";
    else if (link.url.length > LIMITS.url || !isWebAddress(link.url)) errors[`${field}.${index}.url`] = "Une adresse complète : https://…";
    if (link.label.length > LIMITS.label) errors[`${field}.${index}.label`] = `${LIMITS.label} caractères au plus.`;
    return { label: link.label || linkLabel(link.url), url: link.url };
  });
}

/** Vérifie la fiche d'un artiste : la fiche remise au propre, les valeurs pour la base, les erreurs par champ. */
export function readArtistForm(input: ArtistForm): { form: ArtistForm; values: ArtistValues; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const links = tidyLinks(input.links);
  const form: ArtistForm = { ...input, links };

  const name = clean(form.name);
  if (!name) errors.name = "Le nom est obligatoire.";
  else if (name.length > LIMITS.name) errors.name = `${LIMITS.name} caractères au plus.`;
  const { slug, slugFromTitle } = readSlug(clean(form.slug), name, errors);

  const role = clean(form.role);
  if (!oneOf(artistRole.enumValues, role)) errors.role = "Choisis résident ou invité.";

  const bio = longText(form.bio);
  if (bio.length > LIMITS.text) errors.bio = `${LIMITS.text} caractères au plus.`;

  const values = readLinks(links, "links", errors);

  const tags = [...new Set(form.tags.filter((value) => UUID.test(value)).map((value) => value.toLowerCase()))];
  if (tags.length > LIMITS.picks) errors.tags = `${LIMITS.picks} étiquettes au plus.`;

  // Un identifiant de la liste de Radio Cult (un uuid aujourd'hui) : rien d'autre ne s'y tape.
  const radiocultArtistId = form.radiocultArtistId === undefined ? undefined : clean(form.radiocultArtistId) || null;
  if (radiocultArtistId && !/^[A-Za-z0-9_-]{1,64}$/.test(radiocultArtistId)) errors.radiocultArtistId = "Choisis un artiste dans la liste de Radio Cult.";

  return {
    form,
    errors,
    values: {
      name,
      slug,
      slugFromTitle,
      role: role as ArtistRole,
      bio: bio || null,
      links: values,
      tags,
      ...(radiocultArtistId === undefined ? {} : { radiocultArtistId }),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Étiquettes et filtres
// ---------------------------------------------------------------------------------------------------------------

/** Les mots qui gardent leurs majuscules dans une liste collée en capitales : sigles, noms propres. */
const KEPT_WORDS = new Map(
  [
    ...["UK", "USA", "EDM", "IDM", "EBM", "DJ", "MC", "RnB", "R'n'B"],
    ...["Detroit", "Détroit", "Chicago", "Baltimore", "Jersey", "Balkans", "Rajasthan", "Brésil", "Moyen-Orient", "Amérique", "d'Amérique", "Afrique", "Asie", "Europe", "Sud", "Nord"],
    // L'accent qu'on oublie sur une capitale (« ELECTRONIQUE », « EVÉNEMENT ») revient en minuscules.
    ...["électronique", "événement"],
  ].map((word) => [word.normalize("NFD").replace(/^(\p{L})\p{M}+/u, "$1").normalize("NFC").toLocaleLowerCase("fr"), word]),
);

/** « AFRO HOUSE » → « Afro house », « K-POP » → « K-pop », « UK FUNKY » → « UK funky », « ELECTRONIQUE » → « Électronique ». */
function fromCapitals(name: string): string {
  const lower = name
    .toLocaleLowerCase("fr")
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[,;:.!?)]+$/, "");
      const kept = KEPT_WORDS.get(bare) ?? bare.replace(/^(\p{L})-/u, (prefix) => prefix.toLocaleUpperCase("fr"));
      return kept + word.slice(bare.length);
    })
    .join(" ");
  return lower.charAt(0).toLocaleUpperCase("fr") + lower.slice(1);
}

/**
 * Le nom d'une étiquette tel qu'on le garde : sans le gras ni les échappements d'un texte copié d'un document
 * (« **CLUB** », « LIVE SESSION\_ART »), les espaces remis au propre. `capitals` : un nom écrit tout en capitales,
 * comme dans le document des filtres, passe en minuscules.
 */
export function tidyTagName(raw: string, { capitals = false } = {}): string {
  const name = raw
    .replace(/\*\*/g, "")
    .replace(/\\([+_*#])/g, "$1")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—•·*]+\s*|[\s,;.]+$/g, "");
  return capitals && /\p{Lu}/u.test(name) && !/\p{Ll}/u.test(name) ? fromCapitals(name) : name;
}

/**
 * Une ou plusieurs étiquettes à ajouter d'un coup : un nom, ou une liste collée (« AFRO HOUSE, AFROBEATS, AMAPIANO »,
 * séparée par des virgules, des points-virgules ou des retours à la ligne), dont les noms en capitales passent en
 * minuscules. Un nom seul reste tel qu'il est tapé. Chaque nom une fois.
 */
export function readTagNames(text: string): { names: string[]; errors: FieldErrors } {
  const pieces = (text ?? "").split(/[,;\n]+/).filter((piece) => piece.trim());
  const names: string[] = [];
  const seen = new Set<string>();
  for (const piece of pieces) {
    const name = tidyTagName(piece, { capitals: pieces.length > 1 });
    const slug = slugify(name);
    if (!name) continue;
    if (!slug) return { names: [], errors: { names: `« ${name} » : ajoute au moins une lettre ou un chiffre.` } };
    if (name.length > LIMITS.tag) return { names: [], errors: { names: `« ${name.slice(0, 30)}… » : ${LIMITS.tag} caractères au plus par étiquette.` } };
    if (seen.has(slug)) continue;
    seen.add(slug);
    names.push(name);
  }
  if (!names.length) return { names, errors: { names: "Écris un nom d'étiquette." } };
  if (names.length > LIMITS.batch) return { names: [], errors: { names: `${LIMITS.batch} étiquettes au plus d'un coup.` } };
  return { names, errors: {} };
}

/** Le nom et l'adresse d'une étiquette qu'on renomme. Vide, l'adresse est tirée du nom. */
export function readTagForm(input: { name: string; slug: string }): { values: { name: string; slug: string }; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = tidyTagName(input.name ?? "");
  if (!name) errors.name = "Le nom est obligatoire.";
  else if (name.length > LIMITS.tag) errors.name = `${LIMITS.tag} caractères au plus.`;
  const slug = slugify(clean(input.slug) || name);
  if (!slug && name) errors.slug = "Ajoute au moins une lettre ou un chiffre.";
  return { values: { name, slug }, errors };
}

/** Un filtre tel que l'écran l'envoie. */
export type FacetForm = { name: string; slug: string; scope: string; showTypes: string[]; description: string };
export type FacetValues = { name: string; slug: string; scope: FacetScope; showTypes: ShowType[]; description: string | null };

/** Vérifie un filtre : son nom, son adresse, ce qu'il range et, pour les shows, les types concernés (aucun : tous). */
export function readFacetForm(input: FacetForm): { values: FacetValues; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = clean(input.name);
  if (!name) errors.name = "Le nom est obligatoire.";
  else if (name.length > LIMITS.facet) errors.name = `${LIMITS.facet} caractères au plus.`;
  const slug = slugify(clean(input.slug) || name);
  if (!slug && name) errors.slug = "Ajoute au moins une lettre ou un chiffre.";
  const scope = clean(input.scope);
  if (!oneOf(facetScope.enumValues, scope)) errors.scope = "Choisis ce que range ce filtre.";
  const showTypes = scope === "show" ? showType.enumValues.filter((type) => (input.showTypes ?? []).includes(type)) : [];
  const description = longText(input.description);
  if (description.length > LIMITS.description) errors.description = `${LIMITS.description} caractères au plus.`;
  return { values: { name, slug, scope: scope as FacetScope, showTypes, description: description || null }, errors };
}

// ---------------------------------------------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------------------------------------------

/** La fiche d'un événement telle que l'écran l'envoie. */
export type EventForm = {
  title: string;
  slug: string;
  /** Début et fin à Paris, au format d'un champ datetime-local : « 2026-06-13T19:00 ». La fin est facultative. */
  startsAt: string;
  endsAt: string;
  /** Le lieu (« La Goutte d'Or »), et son adresse, pour le lien vers la carte. */
  venue: string;
  address: string;
  description: string;
  /** Le lien d'inscription ou de la billetterie. */
  ticketUrl: string;
  /** Dans l'ordre d'affichage : un identifiant, ou « nouveau:Nom ». */
  artists: string[];
  /** Sa catégorie (Fête, Rencontre/Talk…) : un identifiant d'étiquette, ou « nouveau:Nom ». */
  tags: string[];
};

export type EventValues = {
  title: string;
  slug: string;
  slugFromTitle: boolean;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  address: string | null;
  description: string | null;
  ticketUrl: string | null;
  artists: ArtistPick[];
  tags: TagPick[];
};

export const emptyEventForm = (): EventForm => ({ title: "", slug: "", startsAt: "", endsAt: "", venue: "", address: "", description: "", ticketUrl: "", artists: [], tags: [] });

/**
 * Vérifie la fiche d'un événement. Il lui faut un titre et un début, même en brouillon ; une fin, s'il y en a une,
 * après le début. `publish` : la fiche va être publiée, il lui faut une catégorie.
 */
export function readEventForm(input: EventForm, { publish = false } = {}): { form: EventForm; values: EventValues; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const form: EventForm = { ...input, ticketUrl: withScheme(clean(input.ticketUrl)) };

  const title = clean(form.title);
  if (!title) errors.title = "Le titre est obligatoire.";
  else if (title.length > LIMITS.title) errors.title = `${LIMITS.title} caractères au plus.`;
  const { slug, slugFromTitle } = readSlug(clean(form.slug), title, errors);

  let startsAt: Date | null = null;
  if (!clean(form.startsAt)) errors.startsAt = "Il faut une date et une heure de début.";
  else {
    startsAt = fromParisInput(clean(form.startsAt));
    if (!startsAt) errors.startsAt = "Cette date n'existe pas.";
  }
  let endsAt: Date | null = null;
  if (clean(form.endsAt)) {
    endsAt = fromParisInput(clean(form.endsAt));
    if (!endsAt) errors.endsAt = "Cette date n'existe pas.";
    else if (startsAt && endsAt < startsAt) errors.endsAt = "La fin vient avant le début.";
  }

  const venue = clean(form.venue);
  if (venue.length > LIMITS.name) errors.venue = `${LIMITS.name} caractères au plus.`;
  const address = clean(form.address);
  if (address.length > LIMITS.description) errors.address = `${LIMITS.description} caractères au plus.`;
  const description = longText(form.description);
  if (description.length > LIMITS.text) errors.description = `${LIMITS.text} caractères au plus.`;
  const ticketUrl = clean(form.ticketUrl);
  if (ticketUrl && !isWebAddress(ticketUrl)) errors.ticketUrl = "Une adresse web, qui commence par https://.";
  else if (ticketUrl.length > LIMITS.url) errors.ticketUrl = `${LIMITS.url} caractères au plus.`;

  const artists = unique(form.artists.map(readArtistPick).filter((pick) => pick !== null));
  if (artists.length > LIMITS.picks) errors.artists = `${LIMITS.picks} artistes au plus.`;
  const tags = unique(form.tags.map(readTagPick).filter((pick) => pick !== null));
  if (tags.length > LIMITS.picks) errors.tags = `${LIMITS.picks} étiquettes au plus.`;
  for (const pick of tags) if ("name" in pick && !slugify(pick.name)) errors.tags = `« ${pick.name} » : ajoute au moins une lettre ou un chiffre.`;
  if (publish && !tags.length) errors.tags = "Choisis sa catégorie pour publier.";

  return {
    form,
    errors,
    values: {
      title,
      slug,
      slugFromTitle,
      startsAt: startsAt as Date,
      endsAt,
      venue: venue || null,
      address: address || null,
      description: description || null,
      ticketUrl: ticketUrl || null,
      artists,
      tags,
    },
  };
}

/** La légende d'une photo de la galerie : une phrase sous la photo, en plus de son texte alternatif. */
export function readCaption(text: string): { caption: string | null; errors: FieldErrors } {
  const caption = clean(text);
  return caption.length > LIMITS.caption ? { caption: null, errors: { caption: `${LIMITS.caption} caractères au plus.` } } : { caption: caption || null, errors: {} };
}

// ---------------------------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------------------------

/** Le texte d'une image tel que l'écran l'envoie : son texte alternatif, son crédit, la case « Image décorative ». */
export type MediaTextForm = { alt: string; credit: string; decorative: boolean };
/** Ce que la base en garde : un texte alternatif vide, c'est une image décorative. */
export type MediaText = { alt: string; credit: string | null };

/**
 * Le texte alternatif est demandé à l'envoi (README, 9.3) : ce que montre l'image, pour qui ne la voit pas. Vide
 * seulement pour une image décorative, cochée comme telle. Le crédit (« © Prénom Nom ») est facultatif.
 */
export function readMediaText(input: MediaTextForm): { values: MediaText; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const alt = input.decorative ? "" : clean(input.alt);
  if (!input.decorative && !alt) errors.alt = "Décris l'image en quelques mots, ou coche « Image décorative ».";
  else if (alt.length > LIMITS.alt) errors.alt = `${LIMITS.alt} caractères au plus.`;
  const credit = clean(input.credit);
  if (credit.length > LIMITS.credit) errors.credit = `${LIMITS.credit} caractères au plus.`;
  return { errors, values: { alt, credit: credit || null } };
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

// ---------------------------------------------------------------------------------------------------------------
// La page À propos
// ---------------------------------------------------------------------------------------------------------------

/** Une ligne de L'ÉQUIPE ou des CRÉDITS telle que l'écran l'envoie : le lien vide s'il n'y en a pas. */
export type AboutCreditForm = { role: string; name: string; url: string };

/** La page À propos telle que l'écran l'envoie, avec le corps des mentions légales. Les listes, dans l'ordre. */
export type AboutForm = {
  description: string;
  socials: ArtistLink[];
  team: AboutCreditForm[];
  credits: AboutCreditForm[];
  contactEmail: string;
  applyText: string;
  applyUrl: string;
  applyLabel: string;
  filmTitle: string;
  legal: string;
};

export type AboutValues = {
  description: string;
  socials: ArtistLink[];
  team: AboutCredit[];
  credits: AboutCredit[];
  contactEmail: string | null;
  applyText: string;
  applyUrl: string | null;
  applyLabel: string;
  filmTitle: string;
  legal: string;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Une adresse du site lui-même (« /residents/amara »), pour mener à la page d'un résident. */
const isSitePath = (text: string) => /^\/(?!\/)\S*$/.test(text);

/** Les lignes de L'ÉQUIPE ou des CRÉDITS, sans les vides : le nom est demandé, le rôle et le lien sont facultatifs. */
function readCredits(rows: AboutCreditForm[], field: string, errors: FieldErrors): AboutCredit[] {
  const tidy = rows
    .map((row) => ({ role: clean(row.role), name: clean(row.name), url: isSitePath(clean(row.url)) ? clean(row.url) : withScheme(clean(row.url)) }))
    .filter((row) => row.role || row.name || row.url);
  if (tidy.length > LIMITS.people) errors[field] = `${LIMITS.people} lignes au plus.`;
  return tidy.map((row, index) => {
    const at = (part: string) => `${field}.${index}.${part}`;
    if (!row.name) errors[at("name")] = "Le nom manque.";
    else if (row.name.length > LIMITS.person) errors[at("name")] = `${LIMITS.person} caractères au plus.`;
    if (row.role.length > LIMITS.person) errors[at("role")] = `${LIMITS.person} caractères au plus.`;
    if (row.url && (row.url.length > LIMITS.url || !(isWebAddress(row.url) || isSitePath(row.url)))) errors[at("url")] = "Une adresse complète (https://…) ou une page du site (/residents/…).";
    return { role: row.role, name: row.name, ...(row.url ? { url: row.url } : {}) };
  });
}

/**
 * Vérifie la page À propos : les valeurs pour la base et les erreurs par champ (« team.2.name », « socials.0.url »…).
 * Une adresse e-mail tapée comme lien de CANDIDATER devient un lien « mailto: ».
 */
export function readAboutForm(input: AboutForm): { values: AboutValues; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const description = longText(input.description);
  if (description.length > LIMITS.text) errors.description = `${LIMITS.text} caractères au plus.`;
  const socials = readLinks(tidyLinks(input.socials), "socials", errors);
  const team = readCredits(input.team, "team", errors);
  const credits = readCredits(input.credits, "credits", errors);

  const contactEmail = clean(input.contactEmail).replace(/^mailto:/i, "");
  if (contactEmail && (contactEmail.length > LIMITS.email || !EMAIL.test(contactEmail))) errors.contactEmail = "Une adresse e-mail : nom@domaine.fr";

  const applyText = longText(input.applyText);
  if (applyText.length > LIMITS.description) errors.applyText = `${LIMITS.description} caractères au plus.`;
  const typed = clean(input.applyUrl);
  const applyUrl = EMAIL.test(typed.replace(/^mailto:/i, "")) ? `mailto:${typed.replace(/^mailto:/i, "")}` : withScheme(typed);
  if (applyUrl && (applyUrl.length > LIMITS.url || !(isWebAddress(applyUrl) || applyUrl.startsWith("mailto:"))))
    errors.applyUrl = "L'adresse du formulaire (https://…), ou une adresse e-mail.";
  const applyLabel = clean(input.applyLabel);
  if (!applyLabel) errors.applyLabel = "Le bouton a besoin d'un texte.";
  else if (applyLabel.length > LIMITS.button) errors.applyLabel = `${LIMITS.button} caractères au plus.`;

  const filmTitle = clean(input.filmTitle);
  if (filmTitle.length > LIMITS.title) errors.filmTitle = `${LIMITS.title} caractères au plus.`;
  const legal = longText(input.legal);
  if (legal.length > LIMITS.text) errors.legal = `${LIMITS.text} caractères au plus.`;

  return {
    errors,
    values: { description, socials, team, credits, contactEmail: contactEmail || null, applyText, applyUrl: applyUrl || null, applyLabel, filmTitle, legal },
  };
}
