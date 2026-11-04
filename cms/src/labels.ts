/** Les libellés français des valeurs de la base, pour les écrans d'admin (le site a les siens, en anglais : SHOW…). */
import type { ArtistRole, AudioStatus, ContentStatus, FacetScope, ShowType, TeamRole } from "./schema.ts";

export const LABELS = {
  status: { draft: "Brouillon", published: "Publié" } satisfies Record<ContentStatus, string>,
  showType: { dj_set: "DJ set", playlist: "Playlist", podcast: "Podcast" } satisfies Record<ShowType, string>,
  artistRole: { resident: "Résident", guest: "Invité" } satisfies Record<ArtistRole, string>,
  teamRole: { admin: "Admin", editor: "Éditeur" } satisfies Record<TeamRole, string>,
  /** Ce que range un filtre. */
  facetScope: { show: "Shows", artist: "Artistes", event: "Événements" } satisfies Record<FacetScope, string>,
  /** Où en est un fichier son envoyé par un résident (audio_file.status). */
  audioStatus: {
    uploading: "En route",
    received: "À écouter",
    approved: "Validé",
    sending: "Envoi vers SoundCloud",
    sent: "Sur SoundCloud",
    failed: "Refusé par SoundCloud",
  } satisfies Record<AudioStatus, string>,
  /** Les deux bouts de l'échelle du mood (show.energy). */
  energy: { low: "Calme", high: "Énergique" },
};

/** L'échelle du mood d'un show : de 1 (calme) à 5 (énergique). */
export const ENERGY = { min: 1, max: 5 } as const;
