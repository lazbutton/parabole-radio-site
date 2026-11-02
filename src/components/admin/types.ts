/**
 * Ce que les pages de l'admin passent à l'application React : un écran (son nom, son titre, ses données), préparé par
 * le serveur. La même adresse le sert en HTML au premier affichage et en JSON quand l'application navigue
 * (src/components/admin/router.tsx). Les dates arrivent déjà écrites à l'heure de Paris : le serveur et le
 * navigateur affichent le même texte.
 */
import type {
  AdminChatMessage,
  AdminChatSettings,
  AdminChatTerm,
  AdminFacet,
  AdminTagUse,
  ArtistForm,
  ArtistRole,
  ContentStatus,
  FacetScope,
  FieldErrors,
  ShowForm,
  ShowType,
  TagFilterMenu,
  TeamRole,
} from "@parabole/cms";

export type Viewer = { name: string; email: string; role: TeamRole };
export type Flash = { kind: "success" | "error" | "info"; title: string; description?: string };

/** Un choix d'une liste (artiste, étiquette) ; `note` : une précision montrée à côté (les places d'une étiquette). */
export type Choice = { id: string; name: string; status?: ContentStatus; note?: string };
/** Une étiquette à proposer dans une fiche, avec ses places : le filtre, et le groupe (null : c'est un groupe). */
export type TagChoice = { id: string; name: string; places: { facetId: string; groupId: string | null }[] };
/**
 * Un filtre des fiches de shows ou d'artistes : son nom, les types de shows qu'il range (vide : tous), ses groupes dans
 * l'ordre et les étiquettes de chacun dans l'ordre alphabétique (des identifiants d'étiquettes).
 */
export type FacetChoice = { id: string; name: string; description: string | null; showTypes: ShowType[]; groups: { tagId: string; members: string[] }[] };
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
  missing: { tracklist: number; sound: number; photo: number; bio: number; tags: number };
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
export type ShowsListData = { rows: ShowRow[]; total: number; page: number; pages: number; filters: ShowFilters; artists: Choice[]; tags: TagFilterMenu };

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
  /** Les filtres des shows, pour montrer où va le show. */
  facets: FacetChoice[];
};
export type ShowEditorData = { sheet: ShowSheet };

export type ArtistRow = { id: string; name: string; role: ArtistRole; status: ContentStatus; shows: number; hasPhoto: boolean; hasBio: boolean; tags: string[] };
export type ArtistFilters = { q: string; role: string; status: string; tag: string; missing: string };
export type ArtistsListData = { groups: { letter: string; artists: ArtistRow[] }[]; total: number; filters: ArtistFilters; tags: TagFilterMenu };

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
  /** Les filtres des artistes (Activité…) et leurs étiquettes, à cocher. */
  facets: FacetChoice[];
  tags: TagChoice[];
};
export type ArtistEditorData = { sheet: ArtistSheet };

export type PasswordData = { email: string };

/** Une vidéo de fond, dans l'ordre de la liste. */
export type ClipRow = {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl: string | null;
  /** Son numéro de chaîne : sa place parmi les vidéos de la rotation ; null quand elle est mise de côté. */
  channel: number | null;
  status: ContentStatus;
  /** Livrée avec le site (public/), ou envoyée depuis l'admin (Vercel Blob). */
  origin: "site" | "upload";
  /** « 2:06 · 640 × 360 · 9,6 Mo » */
  facts: string;
  /** « 1 nov. 2026 » : son ajout à la liste. */
  added: string;
};
/** Les vidéos de fond ; `uploads` : l'envoi vers Vercel Blob est branché ; `maxBytes` : le poids maximal d'une vidéo. */
export type ClipsData = { clips: ClipRow[]; uploads: boolean; maxBytes: number };
/** La réponse du serveur à une action de l'écran des vidéos : la liste à jour, ou les erreurs. */
export type ClipsResponse = { ok: true; data: ClipsData; message?: string } | { ok: false; errors: FieldErrors };

/** Une étiquette de l'écran des étiquettes, et ce qui la porte (brouillons compris). */
export type TagRow = AdminTagUse;
/** Un filtre de l'écran des étiquettes : ses groupes dans l'ordre, les étiquettes de chacun dans l'ordre alphabétique. */
export type FacetView = AdminFacet;
/** L'onglet des étiquettes sans place. */
export const UNPLACED = "a-classer";
/** Les étiquettes et les filtres. `current` : l'onglet montré, un filtre (son adresse) ou les étiquettes à classer. */
export type TagsData = { facets: FacetView[]; tags: TagRow[]; current: string };
/** La réponse du serveur à une action de l'écran des étiquettes : le classement à jour, ou les erreurs. */
export type TagsResponse = { ok: true; data: TagsData; message?: string; description?: string } | { ok: false; errors: FieldErrors };
export type { FacetScope };
/** Une couleur de pseudo de l'antenne libre : l'une des sept du télétexte (red, green…). */
export type ChatColor = AdminChatMessage["color"];
/** Un message de l'antenne libre, vu par la régie. */
export type ChatMessageRow = {
  id: string;
  pseudo: string;
  color: ChatColor;
  body: string;
  status: AdminChatMessage["status"];
  /** Pourquoi il ne passe pas, ou plus : la raison lue par son auteur. */
  reason: string | null;
  decidedBy: AdminChatMessage["decidedBy"];
  /** Écrit par la régie (la case PARABOLE). */
  team: boolean;
  authorId: string | null;
  /** « 21:42 », ou « lun. 2 nov., 21:42 » avant aujourd'hui. */
  time: string;
  /** Son passage à l'antenne, en millisecondes : plus tard que maintenant, il est encore en différé. */
  onAir: number;
  /** Les signalements pas encore vus par la régie. */
  reports: number;
  /** Le premier message de ce pseudo. */
  first: boolean;
};
/** Quelqu'un dont l'antenne est coupée : une exclusion en cours (jusqu'à quand), ou un bannissement. */
export type ChatAuthorRow = {
  id: string;
  pseudo: string;
  color: ChatColor;
  mutedUntil: string | null;
  banned: boolean;
  bannedOn: string | null;
  bannedReason: string | null;
  /** « il y a 5 minutes » : son dernier passage. */
  lastSeen: string;
};
/** L'écran de la régie (/admin/antenne). `now` : l'heure du serveur, pour compter le différé. */
export type AntenneData = {
  now: number;
  /** Les durées permises, en secondes (mode lent, différé) et en minutes (exclusion). */
  choices: { slow: number[]; delay: number[]; mute: number[] };
  settings: Omit<AdminChatSettings, "clearedAt"> & { cleared: string | null };
  /** Les derniers messages, du plus récent au plus ancien. */
  messages: ChatMessageRow[];
  /** Ce qui attend la régie, du plus ancien au plus récent. */
  held: ChatMessageRow[];
  reported: ChatMessageRow[];
  people: ChatAuthorRow[];
  terms: AdminChatTerm[];
};
/** La réponse du serveur à une action de la régie : l'écran à jour, ou les erreurs. */
export type AntenneResponse = { ok: true; data: AntenneData; message?: string } | { ok: false; errors: FieldErrors };

/** Un écran de l'application, tel que le serveur le prépare. */
export type Screen =
  | { name: "dashboard"; title: string; data: DashboardData }
  | { name: "shows"; title: string; data: ShowsListData }
  | { name: "show"; title: string; data: ShowEditorData }
  | { name: "artists"; title: string; data: ArtistsListData }
  | { name: "artist"; title: string; data: ArtistEditorData }
  | { name: "password"; title: string; data: PasswordData }
  | { name: "clips"; title: string; data: ClipsData }
  | { name: "antenne"; title: string; data: AntenneData }
  | { name: "tags"; title: string; data: TagsData };

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
