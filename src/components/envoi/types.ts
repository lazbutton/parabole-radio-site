/**
 * Les données de la page d'envoi d'un résident (/envoyer/<jeton>, cms/README.md, 9.12), préparées par le serveur
 * (src/lib/envois.ts) : les dates partent déjà écrites à l'heure de Paris.
 */
import type { ShowType, TrackLine } from "@parabole/cms";
import type { FacetChoice, MediaView, TagChoice, UploadSettings } from "../admin/types";

/** Un bloc proposé : du lundi au dimanche, sa deadline, et ses deux semaines. */
export type EnvoiBlock = { start: string; label: string; deadline: string; deadlineLabel: string; late: boolean; daysLeft: number; weeks: [string, string] };

/** Une émission de l'artiste : un envoi déjà fait, ou un créneau de la grille posé pour lui. */
export type EnvoiRow = {
  showId: string;
  title: string;
  type: ShowType;
  /** Sa diffusion, à Paris ; null tant que l'envoi attend son créneau. */
  when: string | null;
  slot: boolean;
  /** Où en est son son : « Reçu, en attente d'écoute », « Validé par l'équipe »… ; null sans son. */
  status: string | null;
  /** Le bloc visé, pour un envoi qui attend son créneau, en mots ; et le lundi de son bloc (celui de l'envoi, ou celui de sa diffusion). */
  block: string | null;
  blockStart: string | null;
  sent: boolean;
  /** Son son est en route vers SoundCloud, ou déjà publié : l'émission ne se modifie plus. */
  locked: boolean;
};

export type EnvoiPageData = {
  jeton: string;
  artist: { name: string; group: 1 | 2 | null; bio: string; photo: MediaView | null };
  blocks: EnvoiBlock[];
  rows: EnvoiRow[];
  facets: FacetChoice[];
  tags: TagChoice[];
  /** Le seau des fichiers son est branché. */
  audioReady: boolean;
  images: UploadSettings;
};

export type EnvoiPart = { id: string; artist: string; title: string; duration: number | null; fileName: string; size: string };

/** Une émission à remplir ou à corriger. */
export type EnvoiSheet = {
  showId: string;
  version: string;
  title: string;
  type: ShowType;
  when: string | null;
  slot: boolean;
  description: string;
  energy: string;
  tags: string[];
  tracks: TrackLine[];
  cover: MediaView | null;
  note: string;
  link: string;
  blockStart: string | null;
  week: "" | "1" | "2";
  main: { fileName: string; status: string; size: string } | null;
  parts: EnvoiPart[];
};
