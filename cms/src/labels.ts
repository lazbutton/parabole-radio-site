/** Les libellés français des valeurs de la base, pour les écrans d'admin (le site a les siens, en anglais : SHOW…). */
import type { ArtistRole, ContentStatus, FacetScope, ShowType, TeamRole } from "./schema.ts";

export const LABELS = {
  status: { draft: "Brouillon", published: "Publié" } satisfies Record<ContentStatus, string>,
  showType: { dj_set: "DJ set", playlist: "Playlist", podcast: "Podcast" } satisfies Record<ShowType, string>,
  artistRole: { resident: "Résident", guest: "Invité" } satisfies Record<ArtistRole, string>,
  teamRole: { admin: "Admin", editor: "Éditeur" } satisfies Record<TeamRole, string>,
  /** Ce que range un filtre. */
  facetScope: { show: "Émissions", artist: "Résidents", event: "Événements" } satisfies Record<FacetScope, string>,
  /** Les deux bouts de l'échelle du mood (show.energy). */
  energy: { low: "Calme", high: "Énergique" },
};

/**
 * L'échelle du mood d'une émission : de 1 (calme) à 4 (énergique), quatre crans depuis le 4 nov. 2026. La base accepte
 * encore 5 (contrainte show_energy, d'avant) : un 5 enregistré se lit 4 partout (clampEnergy).
 */
export const ENERGY = { min: 1, max: 4 } as const;

/** Un mood tel qu'on l'affiche : dans l'échelle, un ancien 5 compté 4 ; null reste null. */
export const clampEnergy = (value: number | null): number | null => (value == null ? null : Math.min(Math.max(value, ENERGY.min), ENERGY.max));
