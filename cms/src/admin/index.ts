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
import type { NotSaved, Saved } from "./common.ts";
import { fieldErrorsFrom } from "./errors.ts";
import { deleteShow, getShow, listShows, saveShow, showChoices, type AdminShowFilters, type ShowSave } from "./shows.ts";
import { getMember, overview } from "./team.ts";

/** Un refus de la base qui tient à la saisie devient des erreurs par champ ; le reste remonte tel quel. */
async function saving(run: () => Promise<Saved | NotSaved>): Promise<Saved | NotSaved> {
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
    overview: () => as((tx) => overview(tx)),
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
  };
}

export type Admin = ReturnType<typeof createAdmin>;

export type { AdminArtist, AdminArtistFilters, AdminArtistIndex, AdminArtistRow, ArtistSave } from "./artists.ts";
export type { NotSaved, Saved } from "./common.ts";
export {
  emptyArtistForm,
  emptyShowForm,
  isUuid,
  linkLabel,
  mergeTracks,
  NEW_PICK,
  readArtistForm,
  readShowForm,
  type ArtistForm,
  type ArtistValues,
  type FieldErrors,
  type ShowForm,
  type ShowValues,
} from "./input.ts";
export type { AdminShow, AdminShowArtist, AdminShowFilters, AdminShowRow, AdminTag, ShowSave } from "./shows.ts";
export type { Overview, TeamMember } from "./team.ts";
