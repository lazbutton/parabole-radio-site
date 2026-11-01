/**
 * Les fiches de l'admin entre la base, l'écran et le formulaire envoyé : une fiche lue devient des champs à remplir,
 * un formulaire reçu redevient une fiche à vérifier (@parabole/cms, readShowForm et readArtistForm).
 */
import { formatTimecode, toParisInput, type AdminArtist, type AdminShow, type ArtistForm, type ShowForm } from "@parabole/cms";

const text = (data: FormData, name: string) => String(data.get(name) ?? "");
const texts = (data: FormData, name: string) => data.getAll(name).map(String);

/** Les champs d'un show enregistré. */
export function showFormOf(show: AdminShow): ShowForm {
  return {
    title: show.title,
    slug: show.slug,
    type: show.type,
    broadcastAt: show.broadcastAt ? toParisInput(show.broadcastAt) : "",
    duration: show.durationSeconds ? formatTimecode(show.durationSeconds) : "",
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
export const artistFormOf = (artist: AdminArtist): ArtistForm => ({ name: artist.name, slug: artist.slug, role: artist.role, bio: artist.bio ?? "", links: artist.links });

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
  };
}

/** Ce que demande le bouton qui a envoyé le formulaire. */
export type Intent = "save" | "publish" | "unpublish" | "delete";
export const intentOf = (data: FormData): Intent => {
  const intent = text(data, "intent");
  return intent === "publish" || intent === "unpublish" || intent === "delete" ? intent : "save";
};
