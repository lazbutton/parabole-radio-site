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
import { TransactionRollbackError } from "drizzle-orm";
import { asMember, type Tx } from "../access.ts";
import type { Db } from "../db.ts";
import { importSlots, importStatus, radiocultLinks, type ImportInput } from "../radiocult/index.ts";
import type { FacetScope } from "../schema.ts";
import type { TrackLine } from "../tracklist.ts";
import { getAbout, saveAbout, setAboutFilm, setAboutPoster, type AboutSave } from "./about.ts";
import { readTagDocument, syncTagDocument, type DocumentChanges, type DocumentRename } from "./document.ts";
import { artistChoices, deleteArtist, getArtist, listArtists, saveArtist, type AdminArtistFilters, type ArtistSave } from "./artists.ts";
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
import { addEventPhotos, captionEventPhoto, deleteEvent, eventChoices, getEvent, listEvents, orderEventPhotos, removeEventPhoto, saveEvent, type AdminEventFilters, type EventSave } from "./events.ts";
import type { NotSaved } from "./common.ts";
import type { ClipFile, FacetValues, MediaText } from "./input.ts";
import { fieldErrorsFrom } from "./errors.ts";
import { addMedia, describeMedia, getMedia, placeMedia, releaseMedia, type MediaPlace, type MediaSlot, type MediaUpload } from "./media.ts";
import { deleteShow, getShow, listShows, saveShow, showChoices, type AdminShowFilters, type ShowSave } from "./shows.ts";
import {
  addTags,
  deleteFacet,
  deleteTag,
  deleteUnusedTags,
  mergeTags,
  moveFacet,
  moveGroup,
  placeTag,
  renameTag,
  saveFacet,
  tagFilter,
  taxonomy,
  unplaceTag,
  type TagPlace,
} from "./tags.ts";
import { getMember, overview } from "./team.ts";
import { approveAudio, assemblyKey, audioFileById, audioFilesOf, audioKeysOf, deleteAudioFile, deleteUploadLink, getCycle, prepareAssembly, registerAssembly, renewUploadLink, saveCycle, submissionOf, uploadLinkOf } from "./envois.ts";
import { attachCandidates, attachSubmission, rattacherSeul } from "../envois/rattacher.ts";
import {
  acceptApplication,
  applicationCounts,
  declineApplication,
  deleteApplication,
  getApplication,
  getApplicationSettings,
  listApplications,
  moveApplication,
  noteApplication,
  saveApplicationSettings,
  type AdminApplicationFilters,
} from "./candidatures.ts";

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
    /** Lance l'import de la programmation Radio Cult (déjà lue par le serveur), au nom de la personne connectée. */
    importRadioCult: (input: ImportInput) => as((tx) => importSlots(tx, input, { trigger: "manual", memberId: userId })),
    /** Le dernier import de la programmation, et ce qu'il reste à relire. */
    importStatus: () => as((tx) => importStatus(tx)),
    /** Les artistes de Radio Cult déjà reliés à une fiche, par leur identifiant Radio Cult. */
    radiocultLinks: () => as((tx) => radiocultLinks(tx)),
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
    /** Les filtres des artistes et leurs étiquettes, à proposer dans la fiche d'un artiste. */
    artistChoices: () => as((tx) => artistChoices(tx)),
    /** Les événements, brouillons compris : à venir d'abord, puis les passés. */
    listEvents: (filters: AdminEventFilters = {}) => as((tx) => listEvents(tx, filters)),
    /** Un événement à modifier, avec sa galerie, ou null. */
    getEvent: (id: string) => as((tx) => getEvent(tx, id)),
    /** Les artistes et les étiquettes (sa catégorie) à proposer dans la fiche d'un événement. */
    eventChoices: () => as((tx) => eventChoices(tx)),
    /** Enregistre un événement, ses artistes et sa catégorie ; publie ou dépublie au passage. */
    saveEvent: (save: EventSave) => saving(() => as((tx) => saveEvent(tx, save))),
    /** Supprime un événement. Rend son titre et ses images (visuel, galerie), ou null s'il n'existait plus. */
    deleteEvent: (id: string) => as((tx) => deleteEvent(tx, id)),
    /** Ajoute des images envoyées à la fin de la galerie d'un événement. */
    addEventPhotos: (id: string, photos: { mediaId: string; caption: string | null }[]) => saving(() => as((tx) => addEventPhotos(tx, id, photos))),
    /** Range la galerie d'un événement dans cet ordre. */
    orderEventPhotos: (id: string, mediaIds: string[]) => as((tx) => orderEventPhotos(tx, id, mediaIds)),
    /** Change la légende d'une photo de la galerie. */
    captionEventPhoto: (id: string, mediaId: string, caption: string | null) => saving(() => as((tx) => captionEventPhoto(tx, id, mediaId, caption))),
    /** Retire une photo de la galerie. Rend son image, à retirer si elle ne sert plus (releaseMedia). */
    removeEventPhoto: (id: string, mediaId: string) => as((tx) => removeEventPhoto(tx, id, mediaId)),
    /** Le menu « Étiquette » d'une liste (shows, artistes) ; `used` : seulement ce qui sert. */
    tagFilter: (scope: FacetScope, options?: { used?: boolean }) => as((tx) => tagFilter(tx, scope, options)),
    /** Tout le classement des étiquettes : les filtres, leurs groupes, les étiquettes, ce qui les porte. */
    taxonomy: () => as((tx) => taxonomy(tx)),
    /** Ajoute une étiquette, ou une liste, à une place : un nom connu reprend son étiquette, un nom nouveau en crée une. */
    addTags: (place: TagPlace, names: string[]) => saving(() => as((tx) => addTags(tx, place, names))),
    /** Renomme une étiquette, ou change son adresse. */
    renameTag: (id: string, values: { name: string; slug: string }) => saving(() => as((tx) => renameTag(tx, id, values))),
    /** Range une étiquette à une place de plus. */
    placeTag: (id: string, place: TagPlace) => saving(() => as((tx) => placeTag(tx, id, place))),
    /** Retire une étiquette d'une place, sans la supprimer. Faux si elle n'y était plus. */
    unplaceTag: (id: string, place: TagPlace) => as((tx) => unplaceTag(tx, id, place)),
    /** Monte ou descend un groupe dans son filtre. Faux s'il n'y est plus. */
    moveGroup: (facetId: string, id: string, direction: "up" | "down") => as((tx) => moveGroup(tx, facetId, id, direction)),
    /** Fusionne une étiquette dans une autre, qui reprend ses contenus et ses places. */
    mergeTags: (fromId: string, intoId: string) => saving(() => as((tx) => mergeTags(tx, fromId, intoId))),
    /** Supprime une étiquette. Rend son nom, ou null si elle n'existait plus. */
    deleteTag: (id: string) => as((tx) => deleteTag(tx, id)),
    /** Supprime les étiquettes à classer qui ne servent à rien. Rend leur nombre. */
    deleteUnusedTags: () => as((tx) => deleteUnusedTags(tx)),
    /** Crée un filtre, ou le modifie. */
    saveFacet: (save: { id?: string; values: FacetValues }) => saving(() => as((tx) => saveFacet(tx, save))),
    /** Monte ou descend un filtre. Faux s'il n'existe plus. */
    moveFacet: (id: string, direction: "up" | "down") => as((tx) => moveFacet(tx, id, direction)),
    /** Supprime un filtre et ses places ; ses étiquettes restent. Rend son nom, ou null. */
    deleteFacet: (id: string) => as((tx) => deleteFacet(tx, id)),
    /**
     * Ce que changerait le document des filtres (texte Markdown) : l'import est joué pour de bon, puis la transaction
     * est annulée. `renames` : des étiquettes d'avant qui prennent un nom du document.
     */
    previewDocument: (markdown: string, renames: DocumentRename[] = []) =>
      saving(async () => {
        let result: DocumentChanges | NotSaved | undefined;
        try {
          await as(async (tx) => {
            result = await syncTagDocument(tx, readTagDocument(markdown), { renames });
            tx.rollback();
          });
        } catch (error) {
          if (!(error instanceof TransactionRollbackError)) throw error;
        }
        return result!;
      }),
    /** Applique le document des filtres au classement. */
    importDocument: (markdown: string, renames: DocumentRename[] = []) => saving(() => as((tx) => syncTagDocument(tx, readTagDocument(markdown), { renames }))),
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
    /** La page À propos et le corps des mentions légales, ou null si sa ligne manque dans la base. */
    about: () => as((tx) => getAbout(tx)),
    /** Enregistre les textes de la page À propos, et les mentions légales. */
    saveAbout: (save: AboutSave) => saving(() => as((tx) => saveAbout(tx, save))),
    /** Met un film sur la page À propos (ses fichiers sont déjà sur le stockage), le remplace ou l'enlève (null). */
    setAboutFilm: (film: ClipFile | null, version?: string) => saving(() => as((tx) => setAboutFilm(tx, film, version))),
    /** Change l'image fixe du film de la page À propos. */
    setAboutPoster: (posterUrl: string, version?: string) => saving(() => as((tx) => setAboutPoster(tx, posterUrl, version))),
    /** Une image, ou null. */
    getMedia: (id: string) => as((tx) => getMedia(tx, id)),
    /** Inscrit une image envoyée (ses versions sont déjà sur le Storage), avec son texte alternatif et son crédit. */
    addMedia: (file: MediaUpload) => saving(() => as((tx) => addMedia(tx, file))),
    /** Change le texte alternatif et le crédit d'une image. */
    describeMedia: (id: string, text: MediaText) => saving(() => as((tx) => describeMedia(tx, id, text))),
    /** Met une image à sa place sur une fiche (photo d'un artiste, pochette d'un show, visuel d'un événement), ou l'en retire. Rend l'image d'avant. */
    placeMedia: (slot: MediaSlot, place: MediaPlace) => saving(() => as((tx) => placeMedia(tx, slot, place))),
    /** Retire les images envoyées qui ne servent plus. Rend les clés de leurs versions, à effacer du Storage. */
    releaseMedia: (ids: (string | null | undefined)[]) => as((tx) => releaseMedia(tx, ids)),
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
    /** Le lien d'envoi d'un artiste, ou null. */
    uploadLinkOf: (artistId: string) => as((tx) => uploadLinkOf(tx, artistId)),
    /** Crée ou remplace le lien d'envoi d'un artiste : l'ancien cesse de marcher. */
    renewUploadLink: (artistId: string) => as((tx) => renewUploadLink(tx, artistId, userId)),
    /** Désactive le lien d'envoi d'un artiste. */
    deleteUploadLink: (artistId: string) => as((tx) => deleteUploadLink(tx, artistId)),
    /** L'envoi d'un show (qui, quand, son mot, le lien de sa playlist, son bloc), ou null. */
    submissionOf: (showId: string) => as((tx) => submissionOf(tx, showId)),
    /** Les fichiers son d'un show : son son, puis ses morceaux. */
    audioFilesOf: (showId: string) => as((tx) => audioFilesOf(tx, showId)),
    /** Un fichier son, pour l'écouter ou le télécharger : sa clé et son nom d'envoi, ou null. */
    audioFile: (id: string) => as((tx) => audioFileById(tx, id)),
    /** Valide le son d'un show. */
    approveAudio: (id: string) => as((tx) => approveAudio(tx, id)),
    /** Efface un fichier son ; rend sa clé, à effacer du seau. */
    deleteAudioFile: (id: string) => as((tx) => deleteAudioFile(tx, id)),
    /** Un son assemblé par l'équipe (9.13) qui va partir vers le seau : sa ligne et sa clé. */
    prepareAssembly: (showId: string, size: number, options?: { now?: Date }) => saving(() => as((tx) => prepareAssembly(tx, { showId, size, now: options?.now }))),
    /** La clé d'un son assemblé encore en route, ou null. */
    assemblyKey: (fileId: string) => as((tx) => assemblyKey(tx, fileId)),
    /** Le son assemblé, arrivé : le son de l'émission, et sa setlist minutée pour tracklist. Rend les clés à effacer. */
    registerAssembly: (values: { showId: string; fileId: string; sizeBytes: number; durationSeconds: number; tracks: TrackLine[] | null }) => saving(() => as((tx) => registerAssembly(tx, values))),
    /** Les clés des fichiers son de ces shows, à effacer du seau avant de les supprimer. */
    audioKeysOf: (showIds: string[]) => as((tx) => audioKeysOf(tx, showIds)),
    /** Les créneaux où un envoi pourrait aller. */
    attachCandidates: (showId: string, options?: { now?: Date }) => as((tx) => attachCandidates(tx, showId, options)),
    /** Rattache un envoi à un créneau ; rend la pochette remplacée. */
    attachSubmission: (fromId: string, toId: string) => saving(() => as((tx) => attachSubmission(tx, fromId, toId))),
    /** Rattache tout seul les envois qui n'ont qu'un créneau possible (après un import lancé depuis l'admin). */
    rattacherSeul: (options?: { now?: Date }) => as((tx) => rattacherSeul(tx, options)),
    /** Le calendrier des groupes, ou null. */
    cycle: () => as((tx) => getCycle(tx)),
    /** Règle le calendrier des groupes (un admin). */
    saveCycle: (values: { group1Start: string; blockDays: number; deadlineDays: number }) => saving(() => as((tx) => saveCycle(tx, values))),
    /** Les candidatures (9.17), les plus récentes d'abord ; par défaut, celles qui attendent une réponse. */
    listApplications: (filters: AdminApplicationFilters = {}, now?: Date) => as((tx) => listApplications(tx, filters, now)),
    /** Une candidature, avec ses styles et la fiche née de son oui, ou null. */
    getApplication: (id: string, now?: Date) => as((tx) => getApplication(tx, id, now)),
    /** La note de l'équipe sur une candidature. */
    noteApplication: (id: string, note: string) => as((tx) => noteApplication(tx, id, note)),
    /** Remet une candidature à écouter, ou la met de côté (un refus aussi, tant qu'il n'est pas effacé). */
    moveApplication: (id: string, to: "new" | "shortlisted") => as((tx) => moveApplication(tx, id, to)),
    /** Le oui : la fiche d'invité (ou celle qui porte déjà ce nom) et son lien d'envoi, au nom de la personne connectée. */
    acceptApplication: (id: string) => saving(() => as((tx) => acceptApplication(tx, id, userId))),
    /** « Pas cette fois », au nom de la personne connectée. */
    declineApplication: (id: string) => as((tx) => declineApplication(tx, id, userId)),
    /** Efface une candidature tout de suite. Rend son nom, ou null. */
    deleteApplication: (id: string) => as((tx) => deleteApplication(tx, id)),
    /** Les réglages des candidatures : les types ouverts, le délai annoncé. */
    applicationSettings: () => as((tx) => getApplicationSettings(tx)),
    /** Règle les candidatures (un admin). */
    saveApplicationSettings: (settings: { openTypes: string[]; replyDays: number }) => saving(() => as((tx) => saveApplicationSettings(tx, settings))),
    /** Les candidatures qui attendent, pour l'accueil. */
    applicationCounts: (now?: Date) => as((tx) => applicationCounts(tx, now)),
  };
}

export type Admin = ReturnType<typeof createAdmin>;

export { LEGAL_SLUG, type AboutSave, type AdminAbout, type AdminFilm, type FilmPlaced } from "./about.ts";
export type { AdminArtist, AdminArtistFilters, AdminArtistIndex, AdminArtistRow, ArtistSave } from "./artists.ts";
export { DELAY_CHOICES, MUTE_CHOICES, SLOW_CHOICES } from "./chat.ts";
export type { AdminAntenne, AdminChatAuthor, AdminChatMessage, AdminChatSettings, AdminChatTerm, ChatSettingsChange } from "./chat.ts";
export type { AdminClip, ClipAdd, ClipChange, ClipFiles } from "./clips.ts";
export type { AdminEvent, AdminEventFilters, AdminEventPhoto, AdminEventRow, EventSave, GalleryChanged } from "./events.ts";
export { UPLOAD_FOLDER, type AdminMedia, type MediaPlace, type MediaSlot, type MediaUpload } from "./media.ts";
export type { DocumentChanges, DocumentFacet, DocumentRename, FacetChanges, KeptTag, TagDocument } from "./document.ts";
export { readTagDocument } from "./document.ts";
export type { AdminFacet, AdminFacetChoice, AdminTagChoice, AdminTagUse, TagFilterMenu, TagFilterOption, TagPlace, TagsAdded, Taxonomy } from "./tags.ts";
export type { NotSaved, Saved } from "./common.ts";
export {
  CLIP_TYPES,
  emptyArtistForm,
  emptyEventForm,
  emptyShowForm,
  isUuid,
  linkLabel,
  mergeTracks,
  NEW_PICK,
  readAboutForm,
  readArtistForm,
  readCaption,
  readClipFile,
  readClipTitle,
  readEventForm,
  readFacetForm,
  readMediaText,
  readShowForm,
  readTagForm,
  readTagNames,
  tidyTagName,
  type AboutCreditForm,
  type AboutForm,
  type AboutValues,
  type ArtistForm,
  type ArtistValues,
  type ClipFile,
  type ClipFileForm,
  type ClipType,
  type EventForm,
  type EventValues,
  type FacetForm,
  type FacetValues,
  type FieldErrors,
  type MediaText,
  type MediaTextForm,
  type ShowForm,
  type ShowValues,
} from "./input.ts";
export type { AdminShow, AdminShowArtist, AdminShowFilters, AdminShowRow, AdminTag, ShowSave } from "./shows.ts";
export type { Overview, TeamMember } from "./team.ts";
export type { AdminAudioFile, AdminSubmission, AdminUploadLink, DeadlinePanel } from "./envois.ts";
export type { Accepted, AdminApplication, AdminApplicationFilters, AdminApplicationRow, ApplicationCounts } from "./candidatures.ts";
