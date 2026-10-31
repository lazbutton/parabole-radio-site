/** Les libellés français des valeurs de la base, pour les écrans d'admin (le site a les siens, en anglais : SHOW…). */
import type { ArtistRole, ContentStatus, EventCategory, ShowType, TagKind, TeamRole } from "./schema.ts";

export const LABELS = {
  status: { draft: "Brouillon", published: "Publié" } satisfies Record<ContentStatus, string>,
  showType: { dj_set: "DJ set", playlist: "Playlist", podcast: "Podcast" } satisfies Record<ShowType, string>,
  tagKind: { genre: "Genre", mood: "Mood", theme: "Thème" } satisfies Record<TagKind, string>,
  artistRole: { resident: "Résident", guest: "Invité" } satisfies Record<ArtistRole, string>,
  eventCategory: { art_ensemble: "Art ensemble", parabole: "Parabole", special: "Special", talk: "Talk" } satisfies Record<EventCategory, string>,
  teamRole: { admin: "Admin", editor: "Éditeur" } satisfies Record<TeamRole, string>,
};
