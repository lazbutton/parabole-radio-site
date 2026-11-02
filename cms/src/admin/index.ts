/**
 * Les fonctions des écrans d'admin, réunies : chacune lit ou écrit sous le rôle de la personne connectée
 * (asMember), dans une transaction. Les règles d'accès de la base décident donc, quel que soit l'écran : un compte
 * hors de l'équipe ne voit que le publié et n'écrit rien.
 *
 *   const admin = createAdmin(db, user.id); // user : la session vérifiée par Supabase Auth, jamais un champ de formulaire
 *   const { items } = await admin.listShows({ status: "draft" });
 *
 * Un enregistrement rend { ok: true, id… } ou { ok: false, errors } : les erreurs par champ, à montrer à l'écran,
 * qu'elles viennent de la vérification de la saisie ou d'un refus de la base.
 */
import { asMember, type Tx } from "../access.ts";
import type { Db } from "../db.ts";
import { deleteArtist, getArtist, listArtists, saveArtist, type AdminArtistFilters, type ArtistSave } from "./artists.ts";
import {
  addChatTerm,
  antenneOverview,
  banChatAuthor,
  clearChat,
  keepChatMessage,
  liftChatAuthor,
  muteChatAuthor,
  postAsTeam,
  publishChatMessage,
  rejectChatMessage,
  removeChatMessage,
  removeChatTerm,
  saveChatSettings,
  type ChatSettingsChange,
} from "./chat.ts";
import { addClip, deleteClip, getClip, listClips, moveClip, replaceClipFile, updateClip, type ClipAdd, type ClipChange } from "./clips.ts";
import type { NotSaved } from "./common.ts";
import type { ClipFile } from "./input.ts";
import { fieldErrorsFrom } from "./errors.ts";
import { deleteShow, getShow, listShows, saveShow, showChoices, type AdminShowFilters, type ShowSave } from "./shows.ts";
import { getMember, overview } from "./team.ts";

/** Un refus de la base qui tient à la saisie devient des erreurs par champ ; le reste remonte tel quel. */
async function saving<T extends { ok: true }>(run: () => Promise<T | NotSaved>): Promise<T | NotSaved> {
  try {
    return await run();
  } catch (error) {
    const errors = fieldErrorsFrom(error);
    if (errors) return { ok: false, errors };
    throw error;
  }
}

export function createAdmin(db: Db, userId: string) {
  const as = <T>(run: (tx: Tx) => Promise<T>) => asMember(db, userId, run);
  return {
    /** Sa fiche d'équipe, ou null pour un compte hors de l'équipe. */
    member: () => as((tx) => getMember(tx, userId)),
    /** Le tableau de bord. */
    overview: (options?: { now?: Date }) => as((tx) => overview(tx, options)),
    /** Les shows, brouillons compris, filtrés et triés par date. */
    listShows: (filters: AdminShowFilters = {}) => as((tx) => listShows(tx, filters)),
    /** Un show à modifier, ou null. */
    getShow: (id: string) => as((tx) => getShow(tx, id)),
    /** Les artistes et les étiquettes à proposer dans la fiche d'un show. */
    showChoices: () => as((tx) => showChoices(tx)),
    /** Enregistre un show, ses liens et sa tracklist ; publie ou dépublie au passage. */
    saveShow: (save: ShowSave) => saving(() => as((tx) => saveShow(tx, save))),
    /** Supprime un show. Rend son titre, ou null s'il n'existait plus. */
    deleteShow: (id: string) => as((tx) => deleteShow(tx, id)),
    /** Les artistes, brouillons compris, en index A–Z. */
    listArtists: (filters: AdminArtistFilters = {}) => as((tx) => listArtists(tx, filters)),
    /** Un artiste à modifier, avec ses shows, ou null. */
    getArtist: (id: string) => as((tx) => getArtist(tx, id)),
    /** Enregistre un artiste ; publie ou dépublie au passage. */
    saveArtist: (save: ArtistSave) => saving(() => as((tx) => saveArtist(tx, save))),
    /** Supprime un artiste. Rend son nom, ou null s'il n'existait plus. */
    deleteArtist: (id: string) => as((tx) => deleteArtist(tx, id)),
    /** Les vidéos de fond, dans l'ordre de la liste, celles mises de côté comprises. */
    listClips: () => as((tx) => listClips(tx)),
    /** Une vidéo de fond, ou null. */
    getClip: (id: string) => as((tx) => getClip(tx, id)),
    /** Ajoute une vidéo de fond (son fichier est déjà sur le stockage), à la fin de la liste. */
    addClip: (clip: ClipAdd) => saving(() => as((tx) => addClip(tx, clip))),
    /** Change le titre d'une vidéo de fond, ou la met dans la rotation ou de côté. */
    updateClip: (id: string, change: ClipChange) => saving(() => as((tx) => updateClip(tx, id, change))),
    /** Remplace le fichier d'une vidéo de fond. Rend les adresses de l'ancien, à effacer du stockage. */
    replaceClipFile: (id: string, file: ClipFile) => saving(() => as((tx) => replaceClipFile(tx, id, file))),
    /** Monte ou descend une vidéo de fond d'une place. Faux si elle n'existe plus. */
    moveClip: (id: string, direction: "up" | "down") => as((tx) => moveClip(tx, id, direction)),
    /** Supprime une vidéo de fond. Rend les adresses de ses fichiers, à effacer du stockage, ou null. */
    deleteClip: (id: string) => as((tx) => deleteClip(tx, id)),
    /** L'antenne libre : les réglages, les messages, ce qui attend la régie, les sanctions, la liste de mots. */
    antenne: (options?: { now?: Date; limit?: number }) => as((tx) => antenneOverview(tx, options)),
    /** Retire un message : brouillé par la régie chez tout le monde. Faux s'il n'était plus à l'antenne. */
    removeChatMessage: (id: string) => as((tx) => removeChatMessage(tx, userId, id)),
    /** Publie un message en attente, ou rend l'antenne à un message brouillé. */
    publishChatMessage: (id: string) => as((tx) => publishChatMessage(tx, userId, id)),
    /** Rejette un message en attente. */
    rejectChatMessage: (id: string) => as((tx) => rejectChatMessage(tx, userId, id)),
    /** Garde un message signalé : les signalements sont vus. */
    keepChatMessage: (id: string) => as((tx) => keepChatMessage(tx, userId, id)),
    /** Exclut un auteur 1 min, 10 min, 1 h ou 24 h ; ses messages de la dernière demi-heure sont brouillés. */
    muteChatAuthor: (authorId: string, minutes: number) => as((tx) => muteChatAuthor(tx, userId, authorId, minutes)),
    /** Bannit un auteur ; ses messages de la dernière demi-heure sont brouillés. */
    banChatAuthor: (authorId: string, reason: string) => as((tx) => banChatAuthor(tx, userId, authorId, reason)),
    /** Lève une exclusion ou un bannissement. */
    liftChatAuthor: (authorId: string) => as((tx) => liftChatAuthor(tx, userId, authorId)),
    /** Vide l'antenne. */
    clearChat: () => as((tx) => clearChat(tx, userId)),
    /** Change des réglages de l'antenne. */
    saveChatSettings: (change: ChatSettingsChange) => as((tx) => saveChatSettings(tx, userId, change)),
    /** Ajoute un mot à la liste de la régie. */
    addChatTerm: (term: { term: string; action: string; anywhere?: boolean; note?: string }) => saving(() => as((tx) => addChatTerm(tx, userId, term))),
    /** Retire un mot de la liste. Rend le mot, ou null. */
    removeChatTerm: (id: string) => as((tx) => removeChatTerm(tx, userId, id)),
    /** Écrit à l'antenne en tant que Parabole. */
    postAsTeam: (text: string) => saving(() => as((tx) => postAsTeam(tx, userId, text))),
  };
}

export type Admin = ReturnType<typeof createAdmin>;

export type { AdminArtist, AdminArtistFilters, AdminArtistIndex, AdminArtistRow, ArtistSave } from "./artists.ts";
export { DELAY_CHOICES, MUTE_CHOICES, SLOW_CHOICES } from "./chat.ts";
export type { AdminAntenne, AdminChatAuthor, AdminChatMessage, AdminChatSettings, AdminChatTerm, ChatSettingsChange } from "./chat.ts";
export type { AdminClip, ClipAdd, ClipChange, ClipFiles } from "./clips.ts";
export type { NotSaved, Saved } from "./common.ts";
export {
  CLIP_TYPES,
  emptyArtistForm,
  emptyShowForm,
  isUuid,
  linkLabel,
  mergeTracks,
  NEW_PICK,
  readArtistForm,
  readClipFile,
  readClipTitle,
  readShowForm,
  type ArtistForm,
  type ArtistValues,
  type ClipFile,
  type ClipFileForm,
  type ClipType,
  type FieldErrors,
  type ShowForm,
  type ShowValues,
} from "./input.ts";
export type { AdminShow, AdminShowArtist, AdminShowFilters, AdminShowRow, AdminTag, ShowSave } from "./shows.ts";
export type { Overview, TeamMember } from "./team.ts";
