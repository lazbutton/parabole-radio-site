/**
 * Ce que les pages de l'admin passent à l'application React : un écran (son nom, son titre, ses données), préparé par
 * le serveur. La même adresse le sert en HTML au premier affichage et en JSON quand l'application navigue
 * (src/components/admin/router.tsx). Les dates arrivent déjà écrites à l'heure de Paris : le serveur et le
 * navigateur affichent le même texte.
 */
import type { DocumentChanges,
  AboutForm,
  AdminChatMessage,
  AdminChatSettings,
  AdminChatTerm,
  AdminFacet,
  AdminTagUse,
  ArtistForm,
  ArtistRole,
  AudioStatus,
  ContentStatus,
  EventForm,
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
/**
 * Une image d'une fiche, prête à montrer : son adresse dans le seau « media » (la plus grande version), une version
 * réduite pour l'aperçu, ses dimensions, son texte alternatif (vide : image décorative) et son crédit.
 */
export type MediaView = { id: string; url: string; thumb: string; width: number | null; height: number | null; alt: string; credit: string | null };
/** L'envoi des images : branché ou non (la clé secrète de Supabase), et le poids maximal d'un original. */
export type UploadSettings = { ready: boolean; maxBytes: number };
/** La réponse du serveur à une image mise sur une fiche, ou retirée : l'image, et la fiche à jour (cms : placeMedia). */
export type PlaceResponse = { ok: true; image: MediaView | null; version: string | null; updated: string | null } | { ok: false; errors: FieldErrors };

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
  missing: { tracklist: number; sound: number; cover: number; description: number; untagged: number; photo: number; bio: number; tags: number };
  /** Les envois des résidents qui attendent l'équipe (cms/README.md, 9.12). */
  envois: { review: number; failed: number; assemble: number; slot: number };
  /** Les deadlines des groupes : celle qui vient de passer, tant que son bloc n'a pas commencé, puis la prochaine. */
  deadlines: DeadlineView[];
  /** Le calendrier des groupes, réglable par un admin ; null s'il n'est pas réglé. */
  cycle: { group1Start: string; blockDays: number; deadlineDays: number } | null;
  drafts: { href: string; title: string; kind: "show" | "artist"; since: string }[];
  radiocult: RadioCultPanel;
};

/** Une deadline au tableau de bord : le bloc d'un groupe, et ses résidents, avec ou sans envoi. */
export type DeadlineView = {
  group: 1 | 2;
  /** « du lundi 28 déc. au dimanche 10 janv. » */
  block: string;
  /** « dimanche 13 déc. », « dans 9 jours » */
  deadline: string;
  when: string;
  late: boolean;
  sent: number;
  residents: { id: string; name: string; sent: boolean; link: string | null }[];
};

export type CycleResponse = { ok: true; data: DashboardData; message: string } | { ok: false; errors: FieldErrors };

/** Une fiche que cite l'import : son adresse dans l'admin, son titre, ce qu'il en dit. */
export type ImportLine = { href: string; title: string; detail: string };
/** Un passage de l'import : « il y a 3 heures », la date, « la tâche de nuit » ou un prénom, et son résumé. */
export type ImportRunView = { when: string; date: string; by: string; ok: boolean; summary: string };
/**
 * L'import de la programmation Radio Cult, vu de l'accueil (cms/README.md, 9.4) : le dernier passage (et le dernier
 * réussi, si celui-là a échoué), puis ce que le dernier réussi demande encore, relu sur les fiches d'aujourd'hui.
 */
export type RadioCultPanel = {
  /** La clé publishable est posée : les artistes des créneaux sont lus. */
  key: boolean;
  /** Pourquoi l'import ne peut pas tourner (son journal manque dans la base), ou null. */
  unavailable: string | null;
  last: ImportRunView | null;
  lastOk: ImportRunView | null;
  /** Les brouillons créés, puis ceux qui ont suivi leur créneau, toujours en brouillon. */
  created: ImportLine[];
  updated: ImportLine[];
  /** Les shows publiés dont le créneau a bougé, et ceux dont le créneau a disparu. */
  moved: ImportLine[];
  gone: ImportLine[];
  /** Les artistes créés par l'import, toujours en brouillon. */
  artists: ImportLine[];
  notes: string[];
};
/** La réponse du serveur au bouton « Importer maintenant » : l'accueil à jour, et ce qu'a fait l'import. */
export type ImportResponse = { ok: boolean; message: string; data: DashboardData } | { ok: false; errors: FieldErrors };

/** Un artiste de Radio Cult, à choisir pour relier une fiche (son nom est vide pour une fiche sans nom chez Radio Cult). */
export type RadioCultChoice = { id: string; name: string };

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
  hasCover: boolean;
  hasDescription: boolean;
  /** Le nombre de ses étiquettes. */
  tags: number;
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
  cover: MediaView | null;
  uploads: UploadSettings;
  radiocultEventId: string | null;
  artists: Choice[];
  tags: TagChoice[];
  /** Les filtres des shows, pour montrer où va le show. */
  facets: FacetChoice[];
  /** Ce que le show a reçu d'un résident (cms/README.md, 9.12). */
  envoi: EnvoiView;
};
export type ShowEditorData = { sheet: ShowSheet };

/** Un fichier son reçu : le son d'un show, ou un morceau d'une playlist. */
export type AudioView = {
  id: string;
  fileName: string;
  /** « 312 Mo » */
  size: string;
  status: AudioStatus;
  error: string | null;
  /** Écouter et télécharger : des adresses de l'admin (/admin/api/son/<id>), qui signent la lecture dans le seau. */
  listen: string;
  download: string;
  /** Un morceau : son artiste, son titre, sa durée (« 4:05 »). */
  artist: string;
  title: string;
  duration: string;
};

/** L'envoi d'un show : qui, quand, pour quel bloc, son mot ; ses fichiers ; les créneaux où il peut aller. */
export type EnvoiView = {
  submission: {
    artist: { id: string; name: string } | null;
    /** Reçu le…, modifié le… */
    sent: string;
    updated: string | null;
    /** « bloc du 28 déc. », « 1re semaine » */
    block: string | null;
    week: string | null;
    late: boolean;
    /** Le show attend encore son créneau dans la grille de Radio Cult. */
    waiting: boolean;
    note: string | null;
    link: string | null;
  } | null;
  main: AudioView | null;
  parts: AudioView[];
  candidates: { id: string; title: string; when: string }[];
  /** Le seau des fichiers son est branché. */
  ready: boolean;
};

export type EnvoiResponse = { ok: true; envoi: EnvoiView; message: string } | { ok: false; errors: FieldErrors };
export type AttachResponse = { ok: true; redirect: string; message: string } | { ok: false; errors: FieldErrors };

/** Le lien d'envoi d'un artiste : son adresse sur le site (/envoyer/<jeton>), et ce qu'on en sait. */
export type UploadLinkView = { path: string; created: string; used: string | null; profile: string | null };
export type UploadLinkResponse = { ok: true; link: UploadLinkView | null; message: string } | { ok: false; errors: FieldErrors };

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
  photo: MediaView | null;
  uploads: UploadSettings;
  /**
   * Les artistes de la station, pour relier la fiche à l'un d'eux (null : pas de clé publishable, ou Radio Cult ne
   * répond pas), et ceux déjà reliés à une autre fiche, avec son nom.
   */
  radiocult: { choices: RadioCultChoice[] | null; taken: Record<string, string> };
  shows: { id: string; title: string; type: ShowType; status: ContentStatus; date: string }[];
  events: number;
  /** Les filtres des artistes (Activité…) et leurs étiquettes, à cocher. */
  facets: FacetChoice[];
  tags: TagChoice[];
  /** Sa page d'envoi (cms/README.md, 9.12), ou null s'il n'en a pas. */
  uploadLink: UploadLinkView | null;
};
export type ArtistEditorData = { sheet: ArtistSheet };

export type EventRow = {
  id: string;
  title: string;
  /** Sa catégorie : « Fête, Événement spécial ». */
  categories: string;
  artists: string;
  venue: string;
  /** « sam. 13 juin » et « 21:00 » ; « 3 → 13 oct. » sur plusieurs jours, sans heure. */
  day: string;
  time: string;
  /** Le groupe de la liste : « Juin 2026 ». */
  month: string;
  /** Pas encore fini : le groupe « À venir ». */
  upcoming: boolean;
  hasVisual: boolean;
  photos: number;
  status: ContentStatus;
};
export type EventFilters = { q: string; status: string; period: string; tag: string };
export type EventsListData = { rows: EventRow[]; total: number; page: number; pages: number; filters: EventFilters; tags: TagFilterMenu };

/** Une photo de la galerie d'un événement, prête à montrer : l'image, et sa légende (vide : aucune). */
export type GalleryPhoto = { image: MediaView; caption: string };
/** La réponse du serveur à un changement de la galerie : la galerie à jour, ou les erreurs. */
export type GalleryResponse = { ok: true; photos: GalleryPhoto[] } | { ok: false; errors: FieldErrors };

/** L'état d'une fiche d'événement : ce que l'écran montre, et ce que le serveur renvoie après chaque enregistrement. */
export type EventSheet = {
  id: string | null;
  status: ContentStatus;
  version: string;
  created: string | null;
  updated: string | null;
  form: EventForm;
  visual: MediaView | null;
  /** La galerie, dans l'ordre de défilement. */
  photos: GalleryPhoto[];
  uploads: UploadSettings;
  artists: Choice[];
  tags: TagChoice[];
  /** Le filtre des événements (Catégorie), pour choisir à la souris. */
  facets: FacetChoice[];
};
export type EventEditorData = { sheet: EventSheet };

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

/** Le film de la page À propos, prêt à montrer : sa vidéo, son image fixe, son cadre, et « 2:34 · 1920 × 1080 · 48 Mo ». */
export type FilmView = { url: string; poster: string | null; width: number | null; height: number | null; facts: string };
/**
 * La page À propos à remplir (cms/README.md, 9.10) : ses champs, avec le corps des mentions légales ; son film ;
 * l'envoi vers Vercel Blob (branché ou non) et le poids maximal du film.
 */
export type AboutSheet = { version: string; updated: string; form: AboutForm; film: FilmView | null; uploads: boolean; maxBytes: number };
/** Null : la ligne de la page manque dans la base (migration pas appliquée). */
export type AboutData = { sheet: AboutSheet | null };
/**
 * La réponse du serveur à un film mis, remplacé ou enlevé : le film, et la nouvelle version de la page si l'écran avait
 * la dernière (null sinon : son prochain enregistrement signalera qu'on l'a modifiée entre-temps).
 */
export type FilmResponse = { ok: true; film: FilmView | null; version: string | null; updated: string | null; message: string } | { ok: false; errors: FieldErrors };

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
/** L'aperçu de l'import du document des filtres : ce qui changera, ou les erreurs. */
export type DocumentResponse = { ok: true; changes: DocumentChanges } | { ok: false; errors: FieldErrors };
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
  | { name: "events"; title: string; data: EventsListData }
  | { name: "event"; title: string; data: EventEditorData }
  | { name: "password"; title: string; data: PasswordData }
  | { name: "clips"; title: string; data: ClipsData }
  | { name: "antenne"; title: string; data: AntenneData }
  | { name: "tags"; title: string; data: TagsData }
  | { name: "about"; title: string; data: AboutData };

/** Ce que la page passe à l'application : la personne connectée, l'adresse affichée et son écran. */
export type AppProps = { viewer: Viewer; href: string; screen: Screen };

/** La réponse du serveur à une fiche envoyée par l'écran : la fiche à jour, ou la liste où revenir après une suppression. */
export type SaveResponse<S> =
  | { ok: true; sheet: S; created: boolean; newArtists?: number }
  | { ok: true; redirect: string; message?: string }
  | { ok: false; errors: FieldErrors; version?: string };

/** Ce que trouve la recherche de partout (⌘K, /admin/recherche) : quelques shows, quelques artistes, quelques événements. */
export type SearchResults = {
  shows: { id: string; title: string; artists: string; date: string; type: ShowType; status: ContentStatus }[];
  artists: { id: string; name: string; role: ArtistRole; status: ContentStatus; shows: number }[];
  events: { id: string; title: string; date: string; venue: string; status: ContentStatus }[];
};
