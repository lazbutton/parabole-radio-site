/**
 * Ce que partagent la page Émissions (src/pages/emissions/index.astro), son script (src/scripts/emissions.ts), la page
 * d'une émission (src/pages/emissions/[slug].astro) et leurs cartes (src/components/emissions/Carte.astro), d'après les
 * croquis du 4 novembre : l'état de la liste et son adresse (TOUT · PODCAST · PLAYLIST · DJ SET, puis TRIER PAR), ce
 * qui entre dans la grille, les mois du rail (« 05.26 »), les dates et les durées, écrites à l'heure de Paris. Le
 * serveur rend la liste déjà filtrée d'après l'adresse ; le script refait le même calcul sur place, sans recharger.
 */
import type { ShowCard, ShowType } from "@parabole/cms";
import { ENERGY } from "@parabole/cms/labels";
import { STATION_TIMEZONE } from "../scripts/settings";

/** Les onglets du croquis, et ce que chacun vaut dans l'adresse : /emissions?type=dj-set. */
export const ONGLETS: { cle: string; type: ShowType | null; mot: string }[] = [
  { cle: "", type: null, mot: "Tout" },
  { cle: "podcast", type: "podcast", mot: "Podcast" },
  { cle: "playlist", type: "playlist", mot: "Playlist" },
  { cle: "dj-set", type: "dj_set", mot: "DJ set" },
];

/** Le type d'une émission, tel que l'écrivent les onglets et les cartes. */
export const MOT_DU_TYPE: Record<ShowType, string> = { dj_set: "DJ set", playlist: "Playlist", podcast: "Podcast" };

/**
 * Le mood (show.energy), de 1 (calme) à 4 (énergique), comme le curseur de l'admin : il se choisit dans TRIER PAR,
 * comme un filtre, sauf pour les podcasts, qui n'en ont pas.
 */
export const MOOD = "mood";
export const MOODS = Array.from({ length: ENERGY.max - ENERGY.min + 1 }, (_, index) => ENERGY.min + index);
/** Les types qui ont un mood. */
export const TYPES_AVEC_MOOD: ShowType[] = ["dj_set", "playlist"];

/** Un filtre de TRIER PAR : son adresse (« genre ») et les types qu'il range (vide : tous), comme dans l'admin. */
export type Facette = { slug: string; showTypes: ShowType[] };

/** Les filtres qui valent pour un type ; sans type (TOUT), tous. */
export const facettesDuType = <F extends Facette>(type: ShowType | null, facettes: F[]): F[] =>
  facettes.filter((facette) => !type || !facette.showTypes.length || facette.showTypes.includes(type));

/** Le mood vaut-il pour ce type ? Pas pour les podcasts. */
export const avecMood = (type: ShowType | null) => !type || TYPES_AVEC_MOOD.includes(type);

/**
 * L'état de la liste, tel que le dit son adresse : le type, une étiquette par filtre (« ?genre=soul&geographie=asie »),
 * le mood et le panneau TRIER PAR ouvert.
 */
export type EtatListe = {
  type: ShowType | null;
  /** Une adresse d'étiquette (une étiquette, ou un groupe) par filtre de l'admin : { genre: "soul" }. */
  filtres: Record<string, string>;
  mood: number | null;
  /** Le panneau ouvert (« genre », « mood »…), vide s'il est fermé. */
  trier: string;
};

/** Le type demandé par l'adresse (?type=dj-set), ou null : tout. */
export function lireType(params: URLSearchParams): ShowType | null {
  return ONGLETS.find((onglet) => onglet.cle && onglet.cle === params.get("type"))?.type ?? null;
}

/**
 * L'état d'une adresse. Seuls comptent les filtres qui valent pour son type (genre et géographie pour les DJ sets ;
 * thème pour les podcasts ; tous pour TOUT) ; un paramètre qui n'en est pas un est ignoré. Le mood ne vaut pas pour
 * les podcasts.
 */
export function lireEtat(params: URLSearchParams, facettes: Facette[]): EtatListe {
  const type = lireType(params);
  const valables = facettesDuType(type, facettes).map((facette) => facette.slug);
  const filtres: Record<string, string> = {};
  for (const facette of valables) {
    const valeur = (params.get(facette) ?? "").trim().toLowerCase();
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(valeur)) filtres[facette] = valeur;
  }
  const mood = Number(params.get(MOOD));
  const trier = params.get("trier") ?? "";
  return {
    type,
    filtres,
    mood: avecMood(type) && Number.isInteger(mood) && mood >= ENERGY.min && mood <= ENERGY.max ? mood : null,
    trier: valables.includes(trier) || (avecMood(type) && trier === MOOD) ? trier : "",
  };
}

/** L'adresse d'un état, la plus courte : /emissions pour tout, sans filtre. */
export function adresseDe(etat: EtatListe, ancre = ""): string {
  const params = new URLSearchParams();
  const cle = ONGLETS.find((onglet) => onglet.type === etat.type)?.cle;
  if (cle) params.set("type", cle);
  for (const [facette, valeur] of Object.entries(etat.filtres)) if (valeur) params.set(facette, valeur);
  if (etat.mood) params.set(MOOD, String(etat.mood));
  if (etat.trier) params.set("trier", etat.trier);
  const suite = params.toString();
  return "/emissions" + (suite ? "?" + suite : "") + (ancre ? "#" + ancre : "");
}

/** Ce qu'il faut savoir d'une émission pour la filtrer : son type, ses étiquettes (leurs adresses), son mood. */
export type CarteFiltrable = { type: ShowType; etiquettes: string[]; mood: number | null };

/**
 * Ce que couvre l'étiquette choisie dans un filtre (clé « genre/club ») : elle-même et, si c'est un groupe, les
 * étiquettes du groupe. Choisir Club trouve aussi les émissions Amapiano, comme dans le CMS (coveredTags).
 */
export type Couvertures = Map<string, string[]>;
export const cleDe = (facette: string, slug: string) => `${facette}/${slug}`;

/** Une émission entre-t-elle dans la grille ? Son type, une étiquette couverte par chaque filtre choisi, son mood. */
export function correspond(carte: CarteFiltrable, etat: Pick<EtatListe, "type" | "filtres" | "mood">, couvertures: Couvertures): boolean {
  if (etat.type && carte.type !== etat.type) return false;
  if (etat.mood && carte.mood !== etat.mood) return false;
  for (const [facette, slug] of Object.entries(etat.filtres)) {
    const couvre = couvertures.get(cleDe(facette, slug)) ?? [slug];
    if (!carte.etiquettes.some((etiquette) => couvre.includes(etiquette))) return false;
  }
  return true;
}

/**
 * Combien d'émissions donnerait un choix dans un filtre (les autres filtres gardés) : le nombre de chaque pastille de
 * TRIER PAR. `slug` vide : sans ce filtre (la pastille TOUT).
 */
export function compter(cartes: CarteFiltrable[], etat: Pick<EtatListe, "type" | "filtres" | "mood">, couvertures: Couvertures, facette: string, slug: string): number {
  const { [facette]: _retire, ...autres } = etat.filtres;
  const essai = facette === MOOD ? { ...etat, mood: slug ? Number(slug) : null } : { ...etat, filtres: slug ? { ...autres, [facette]: slug } : autres };
  return cartes.reduce((n, carte) => n + (correspond(carte, essai, couvertures) ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Les dates, à l'heure de Paris
// ---------------------------------------------------------------------------------------------------------------

const fr = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: STATION_TIMEZONE, ...options });
const chiffres = fr({ day: "2-digit", month: "2-digit", year: "2-digit" });
const longue = fr({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const heure = fr({ hour: "2-digit", minute: "2-digit" });
const moisEnLettres = fr({ month: "long", year: "numeric" });

const parties = (format: Intl.DateTimeFormat, date: Date) => Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));

/** Le mois d'une diffusion à Paris, comme le CMS les compte (listShowMonths) : « 2026-05 ». */
export function moisDe(date: Date): string {
  const p = parties(fr({ year: "numeric", month: "2-digit" }), date);
  return `${p.year}-${p.month}`;
}

/** Le mois écrit comme sur le croquis, sur le rail et dans le coin des cartes : « 05.26 ». */
export const libelleMois = (mois: string) => `${mois.slice(5, 7)}.${mois.slice(2, 4)}`;

/** « mai 2026 », pour les lecteurs d'écran et les bulles. */
export const moisEnClair = (mois: string) => moisEnLettres.format(new Date(`${mois}-15T12:00:00Z`));

/** L'ancre du premier show d'un mois dans la grille : #mois-2026-05. */
export const ancreDuMois = (mois: string) => `mois-${mois}`;

/** La date d'une carte, en chiffres comme les mois du rail : « 12.05.26 ». */
export function dateEnChiffres(date: Date): string {
  const p = parties(chiffres, date);
  return `${p.day}.${p.month}.${p.year}`;
}

/** La date de la page d'une émission : « Dimanche 12 mai 2026 · 21:00 », le premier du mois écrit « 1er ». */
export function dateEnLettres(date: Date): string {
  const p = parties(longue, date);
  const jour = p.day === "1" ? "1er" : p.day;
  const semaine = (p.weekday ?? "").charAt(0).toUpperCase() + (p.weekday ?? "").slice(1);
  return `${semaine} ${jour} ${p.month} ${p.year} · ${heure.format(date)}`;
}

/** Une durée : « 2 h », « 1 h 30 », « 45 min ». */
export function duree(secondes: number | null | undefined): string {
  if (!secondes || secondes <= 0) return "";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Les artistes d'une carte : « Amara Diallo · Nour ». */
export const nomsDe = (show: Pick<ShowCard, "artists">) => show.artists.map((artiste) => artiste.name).join(" · ");

/** La plus petite version d'une image : la vignette d'une ligne, l'image floutée du fond. */
export const petite = (srcset: string | null | undefined, url: string) => srcset?.split(",")[0]?.trim().split(/\s+/)[0] || url;
