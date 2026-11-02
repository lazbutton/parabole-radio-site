/**
 * Les refus de la base, traduits en messages pour l'écran. La plupart sont arrêtés avant (src/admin/input.ts) ; ceux
 * qui passent quand même (deux personnes qui prennent la même adresse au même moment…) arrivent ici.
 */
import type { FieldErrors } from "./input.ts";

/** Le champ et le message de chaque contrainte que l'écran peut déclencher. */
const CONSTRAINTS: Record<string, [field: string, message: string]> = {
  show_slug_unique: ["slug", "Cette adresse sert déjà à un autre show."],
  show_slug_format: ["slug", "Minuscules, chiffres et tirets seulement."],
  show_soundcloud_track_id_unique: ["soundcloudTrackId", "Cette piste SoundCloud est déjà liée à un autre show."],
  show_soundcloud_track_id: ["soundcloudTrackId", "Des chiffres seulement."],
  show_soundcloud_url: ["soundcloudUrl", "L'adresse de la piste commence par https://soundcloud.com/."],
  show_published_has_date: ["broadcastAt", "Il faut une date de diffusion pour publier."],
  show_duration: ["duration", "La durée doit dépasser zéro."],
  show_energy: ["energy", "Le mood va de 1 (calme) à 5 (énergique)."],
  track_hopper_url: ["tracks", "Un lien Hopper commence par https://hppr.fr/."],
  track_start: ["tracks", "Un minutage ne peut pas être négatif."],
  artist_slug_unique: ["slug", "Cette adresse sert déjà à un autre artiste."],
  artist_slug_format: ["slug", "Minuscules, chiffres et tirets seulement."],
  tag_slug_format: ["tags", "Une étiquette doit contenir au moins une lettre ou un chiffre."],
  tag_slug_unique: ["tags", "Une autre étiquette vient de prendre cette adresse. Réessaie : elle sera reprise telle quelle."],
  tag_member_not_its_group: ["form", "Un groupe ne se range pas dans lui-même : il vaut déjà pour lui."],
  tag_member_group_fk: ["form", "Ce groupe n'existe plus : la page a peut-être changé entre-temps."],
  facet_slug_unique: ["slug", "Cette adresse sert déjà à un autre filtre."],
  facet_slug_format: ["slug", "Minuscules, chiffres et tirets seulement."],
  background_clip_video_url_unique: ["video", "Cette vidéo est déjà dans la liste."],
  background_clip_video_url: ["video", "L'adresse de la vidéo n'est pas valable."],
  background_clip_poster_url: ["video", "L'adresse de l'image d'attente n'est pas valable."],
};

/** L'erreur Postgres derrière un échec : Drizzle l'enveloppe (« Failed query… ») et garde l'originale dans « cause ». */
function postgresError(error: unknown): { code?: string; constraint?: string } {
  const original = (error as { cause?: unknown })?.cause ?? error;
  // postgres-js nomme la contrainte « constraint_name », PGlite « constraint ».
  const { code, constraint_name, constraint } = (original ?? {}) as { code?: string; constraint_name?: string; constraint?: string };
  return { code, constraint: constraint_name ?? constraint };
}

/** Les erreurs par champ d'un refus de la base, ou null si ce refus n'est pas une saisie à corriger. */
export function fieldErrorsFrom(error: unknown): FieldErrors | null {
  const { code, constraint } = postgresError(error);
  const known = constraint ? CONSTRAINTS[constraint] : undefined;
  if (known) return { [known[0]]: known[1] };
  // Une règle d'accès qui refuse (42501) : le compte n'est plus dans l'équipe, ou n'a pas ce droit.
  if (code === "42501") return { form: "La base refuse cette écriture à ton compte. Il ne fait peut-être plus partie de l'équipe." };
  return null;
}
