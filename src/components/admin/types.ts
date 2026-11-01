/**
 * Ce que les pages de l'admin passent à l'application React : un écran (son nom, son titre, ses données), préparé par
 * le serveur. La même adresse le sert en HTML au premier affichage et en JSON quand l'application navigue
 * (src/components/admin/router.tsx). Les dates arrivent déjà écrites à l'heure de Paris : le serveur et le
 * navigateur affichent le même texte.
 */
import type { ArtistForm, ArtistRole, ContentStatus, FieldErrors, ShowForm, ShowType, TagKind, TeamRole } from "@parabole/cms";

export type Viewer = { name: string; email: string; role: TeamRole };
export type Flash = { kind: "success" | "error" | "info"; title: string; description?: string };

export type Choice = { id: string; name: string; status?: ContentStatus };
export type TagChoice = { id: string; name: string; kind: TagKind };
export type MediaView = { key: string; alt: string } | null;

/** Le nombre de contenus publiés et en brouillon. */
export type Counts = { published: number; draft: number };

export type DashboardData = {
  /** « dimanche 1 novembre » */
  today: string;
  stats: { shows: Counts; artists: Counts };
  /** Les prochaines diffusions, de la plus proche à la plus lointaine. */
  upcoming: {
    href: string;
    title: string;
    artists: string;
    type: ShowType;
    status: ContentStatus;
    /** « jeu. », « 5 », « nov. » : la petite page de calendrier ; « 18:00 » ; « dans 4 jours ». */
    weekday: string;
    dayOfMonth: string;
    month: string;
    time: string;
    when: string;
  }[];
  /** Ce qui reste à compléter, compté comme les listes filtrées où l'on arrive (cms : overview). */
  missing: { tracklist: number; sound: number; photo: number; bio: number };
  drafts: { href: string; title: string; kind: "show" | "artist"; since: string }[];
};

export type ShowRow = {
  id: string;
  title: string;
  artists: string;
  type: ShowType;
  /** « jeu. 5 nov. » et « 18:00 » ; vides pour un show sans date. */
  day: string;
  time: string;
  /** Le groupe de la liste : « Novembre 2026 », vide sans date. */
  month: string;
  /** Diffusion pas encore passée : le groupe « À venir ». */
  upcoming: boolean;
  duration: string;
  tracks: number;
  hasSound: boolean;
  status: ContentStatus;
  fromRadioCult: boolean;
};
export type ShowFilters = { q: string; status: string; type: string; tag: string; artist: string; missing: string; order: string };
export type ShowsListData = { rows: ShowRow[]; total: number; page: number; pages: number; filters: ShowFilters; artists: Choice[]; tags: TagChoice[] };

/** L'état d'une fiche de show : ce que l'écran montre, et ce que le serveur renvoie après chaque enregistrement. */
export type ShowSheet = {
  id: string | null;
  status: ContentStatus;
  version: string;
  created: string | null;
  updated: string | null;
  form: ShowForm;
  cover: MediaView;
  radiocultEventId: string | null;
  artists: Choice[];
  tags: TagChoice[];
};
export type ShowEditorData = { sheet: ShowSheet };

export type ArtistRow = { id: string; name: string; role: ArtistRole; status: ContentStatus; shows: number; hasPhoto: boolean; hasBio: boolean };
export type ArtistFilters = { q: string; role: string; status: string; missing: string };
export type ArtistsListData = { groups: { letter: string; artists: ArtistRow[] }[]; total: number; filters: ArtistFilters };

export type ArtistSheet = {
  id: string | null;
  status: ContentStatus;
  version: string;
  created: string | null;
  updated: string | null;
  form: ArtistForm;
  photo: MediaView;
  radiocultArtistId: string | null;
  shows: { id: string; title: string; type: ShowType; status: ContentStatus; date: string }[];
  events: number;
};
export type ArtistEditorData = { sheet: ArtistSheet };

export type PasswordData = { email: string };

/** Un écran de l'application, tel que le serveur le prépare. */
export type Screen =
  | { name: "dashboard"; title: string; data: DashboardData }
  | { name: "shows"; title: string; data: ShowsListData }
  | { name: "show"; title: string; data: ShowEditorData }
  | { name: "artists"; title: string; data: ArtistsListData }
  | { name: "artist"; title: string; data: ArtistEditorData }
  | { name: "password"; title: string; data: PasswordData };

/** Ce que la page passe à l'application : la personne connectée, l'adresse affichée et son écran. */
export type AppProps = { viewer: Viewer; href: string; screen: Screen };

/** La réponse du serveur à une fiche envoyée par l'écran : la fiche à jour, ou la liste où revenir après une suppression. */
export type SaveResponse<S> =
  | { ok: true; sheet: S; created: boolean; newArtists?: number }
  | { ok: true; redirect: string; message?: string }
  | { ok: false; errors: FieldErrors; version?: string };

/** Ce que trouve la recherche de partout (⌘K, /admin/recherche) : quelques shows et quelques artistes. */
export type SearchResults = {
  shows: { id: string; title: string; artists: string; date: string; type: ShowType; status: ContentStatus }[];
  artists: { id: string; name: string; role: ArtistRole; status: ContentStatus; shows: number }[];
};
