/**
 * Les fiches de l'admin entre la base, l'écran et le formulaire envoyé : une fiche lue devient des champs à remplir,
 * un formulaire reçu redevient une fiche à vérifier (@parabole/cms, readShowForm, readArtistForm, readEventForm).
 */
import { clampEnergy, formatTimecode, toParisInput, type AboutCreditForm, type AboutForm, type AdminAbout, type AdminArtist, type AdminEvent, type AdminShow, type ArtistForm, type EventForm, type ShowForm } from "@parabole/cms";

const text = (data: FormData, name: string) => String(data.get(name) ?? "");
const texts = (data: FormData, name: string) => data.getAll(name).map(String);

/** Les champs d'une émission enregistrée (un ancien mood 5 revient à 4). */
export function showFormOf(show: AdminShow): ShowForm {
  return {
    title: show.title,
    slug: show.slug,
    type: show.type,
    broadcastAt: show.broadcastAt ? toParisInput(show.broadcastAt) : "",
    duration: show.durationSeconds ? formatTimecode(show.durationSeconds) : "",
    energy: show.energy ? String(clampEnergy(show.energy)) : "",
    description: show.description ?? "",
    soundcloudUrl: show.soundcloudUrl ?? "",
    soundcloudTrackId: show.soundcloudTrackId ?? "",
    artists: show.artists.map((artist) => artist.id),
    tags: show.tags.map((tag) => tag.id),
    tracks: show.tracks.map((line) => ({
      artist: line.artist,
      title: line.title,
      start: line.startSeconds === null ? "" : formatTimecode(line.startSeconds),
      hopperUrl: line.hopperUrl ?? "",
    })),
    pasted: "",
  };
}

/**
 * Le formulaire d'un show tel que l'écran l'envoie (ShowEditor). Un artiste ou une étiquette à créer arrive en
 * « nouveau:… » : la base retrouve celui du même nom s'il existe.
 */
export function showFormFrom(data: FormData): ShowForm {
  const starts = texts(data, "trackStart");
  const artists = texts(data, "trackArtist");
  const titles = texts(data, "trackTitle");
  const links = texts(data, "trackHopper");
  const rows = Math.max(starts.length, artists.length, titles.length, links.length);
  return {
    title: text(data, "title"),
    slug: text(data, "slug"),
    type: text(data, "type"),
    broadcastAt: text(data, "broadcastAt"),
    duration: text(data, "duration"),
    energy: text(data, "energy"),
    description: text(data, "description"),
    soundcloudUrl: text(data, "soundcloudUrl"),
    soundcloudTrackId: text(data, "soundcloudTrackId"),
    artists: texts(data, "artist"),
    tags: texts(data, "tag"),
    tracks: Array.from({ length: rows }, (_, index) => ({
      start: starts[index] ?? "",
      artist: artists[index] ?? "",
      title: titles[index] ?? "",
      hopperUrl: links[index] ?? "",
    })),
    pasted: text(data, "pasted"),
  };
}

/** Les champs d'un artiste enregistré. */
export const artistFormOf = (artist: AdminArtist): ArtistForm => ({
  name: artist.name,
  slug: artist.slug,
  role: artist.role,
  bio: artist.bio ?? "",
  links: artist.links,
  tags: artist.tags.map((tag) => tag.id),
  radiocultArtistId: artist.radiocultArtistId ?? "",
});

/** Le formulaire d'un artiste tel qu'envoyé. */
export function artistFormFrom(data: FormData): ArtistForm {
  const labels = texts(data, "linkLabel");
  const urls = texts(data, "linkUrl");
  return {
    name: text(data, "name"),
    slug: text(data, "slug"),
    role: text(data, "role"),
    bio: text(data, "bio"),
    links: Array.from({ length: Math.max(labels.length, urls.length) }, (_, index) => ({ label: labels[index] ?? "", url: urls[index] ?? "" })),
    tags: texts(data, "tag"),
    // Absent du formulaire (Radio Cult ne répondait pas à l'ouverture de la fiche) : le lien ne change pas.
    ...(data.has("radiocultArtistId") ? { radiocultArtistId: text(data, "radiocultArtistId") } : {}),
  };
}

/** Les champs d'un événement enregistré. */
export const eventFormOf = (event: AdminEvent): EventForm => ({
  title: event.title,
  slug: event.slug,
  startsAt: toParisInput(event.startsAt),
  endsAt: event.endsAt ? toParisInput(event.endsAt) : "",
  venue: event.venue ?? "",
  address: event.address ?? "",
  description: event.description ?? "",
  ticketUrl: event.ticketUrl ?? "",
  artists: event.artists.map((artist) => artist.id),
  tags: event.tags.map((tag) => tag.id),
});

/** Le formulaire d'un événement tel qu'envoyé (EventEditor). */
export const eventFormFrom = (data: FormData): EventForm => ({
  title: text(data, "title"),
  slug: text(data, "slug"),
  startsAt: text(data, "startsAt"),
  endsAt: text(data, "endsAt"),
  venue: text(data, "venue"),
  address: text(data, "address"),
  description: text(data, "description"),
  ticketUrl: text(data, "ticketUrl"),
  artists: texts(data, "artist"),
  tags: texts(data, "tag"),
});

/** Les champs de la page À propos enregistrée ; un lien absent devient un champ vide. */
export const aboutFormOf = (about: AdminAbout): AboutForm => ({
  description: about.description,
  socials: about.socials,
  team: about.team.map((row) => ({ role: row.role, name: row.name, url: row.url ?? "" })),
  credits: about.credits.map((row) => ({ role: row.role, name: row.name, url: row.url ?? "" })),
  contactEmail: about.contactEmail ?? "",
  applyText: about.applyText,
  applyUrl: about.applyUrl ?? "",
  applyLabel: about.applyLabel,
  filmTitle: about.filmTitle,
  legal: about.legal,
});

/** Le formulaire de la page À propos tel qu'envoyé : les lignes de l'équipe (« team… ») et des crédits (« credit… »). */
export function aboutFormFrom(data: FormData): AboutForm {
  const rows = (prefix: string): AboutCreditForm[] => {
    const roles = texts(data, `${prefix}Role`);
    const names = texts(data, `${prefix}Name`);
    const urls = texts(data, `${prefix}Url`);
    return Array.from({ length: Math.max(roles.length, names.length, urls.length) }, (_, index) => ({ role: roles[index] ?? "", name: names[index] ?? "", url: urls[index] ?? "" }));
  };
  const labels = texts(data, "socialLabel");
  const urls = texts(data, "socialUrl");
  return {
    description: text(data, "description"),
    socials: Array.from({ length: Math.max(labels.length, urls.length) }, (_, index) => ({ label: labels[index] ?? "", url: urls[index] ?? "" })),
    team: rows("team"),
    credits: rows("credit"),
    contactEmail: text(data, "contactEmail"),
    applyText: text(data, "applyText"),
    applyUrl: text(data, "applyUrl"),
    applyLabel: text(data, "applyLabel"),
    filmTitle: text(data, "filmTitle"),
    legal: text(data, "legal"),
  };
}

/** Ce que demande le bouton qui a envoyé le formulaire. */
export type Intent = "save" | "publish" | "unpublish" | "delete";
export const intentOf = (data: FormData): Intent => {
  const intent = text(data, "intent");
  return intent === "publish" || intent === "unpublish" || intent === "delete" ? intent : "save";
};
