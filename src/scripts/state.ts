import type { NowPlaying, Track } from "../lib/station/types";

/** Un morceau vu passer à l'antenne, avec son heure de début. */
export type Play = Track & { played_at: string; key?: string };

/**
 * Ce que les modules de la coque partagent. Il vit tant que l'onglet est ouvert : la navigation ne recharge pas les
 * scripts, donc rien ne se perd d'une page à l'autre.
 */
export const station = {
  /** La dernière réponse du direct (HISTORIQUE), avec l'heure de début du morceau. */
  now: null as (NowPlaying & { played_at?: string }) | null,
  /** Le niveau des basses, de 0 à 1 face à leur plus fort récent (GLOBE) ; null tant que rien n'est analysé. */
  level: null as number | null,
  /** Les morceaux vus passer sur cette page, du plus récent au plus ancien (HISTORIQUE). */
  played: [] as Play[],
};
