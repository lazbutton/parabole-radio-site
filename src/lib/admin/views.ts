/**
 * Les données des écrans de l'application d'admin, préparées par le serveur (src/components/admin/types.ts) : la
 * personne connectée, une fiche de show ou d'artiste avec ce qu'il faut pour la remplir, et les réponses en JSON. Les
 * dates partent déjà écrites à l'heure de Paris.
 */
import { emptyArtistForm, emptyShowForm, formatTimecode, type Admin, type AdminArtist, type AdminClip, type AdminShow, type TeamMember, type Taxonomy } from "@parabole/cms";
import { UNPLACED, type ArtistSheet, type ClipsData, type ShowSheet, type TagsData, type Viewer } from "../../components/admin/types";
import { blobReady, MAX_VIDEO_BYTES } from "./blob";
import { artistFormOf, showFormOf } from "./forms";
import { megabytes, parisDateTime, parisDay } from "./format";

export const viewerOf = (member: TeamMember): Viewer => ({ name: member.name, email: member.email, role: member.role });

/**
 * Une fiche de show à afficher (vide pour un nouveau show), avec les artistes et les étiquettes à proposer. Une
 * étiquette du show rangée seulement dans un filtre d'un autre contenu (Activité…) s'y ajoute, pour garder son nom.
 */
export async function showSheet(admin: Admin, show: AdminShow | null): Promise<ShowSheet> {
  const choices = await admin.showChoices();
  const known = new Set(choices.tags.map((tag) => tag.id));
  const others = (show?.tags ?? []).filter((tag) => !known.has(tag.id)).map((tag) => ({ ...tag, places: [] }));
  return {
    id: show?.id ?? null,
    status: show?.status ?? "draft",
    version: show?.version ?? "",
    created: show ? parisDateTime(show.createdAt) : null,
    updated: show ? parisDateTime(show.updatedAt) : null,
    form: show ? showFormOf(show) : emptyShowForm(),
    cover: show?.cover ?? null,
    radiocultEventId: show?.radiocultEventId ?? null,
    artists: choices.artists,
    tags: [...choices.tags, ...others],
    facets: choices.facets,
  };
}

/** Une fiche d'artiste à afficher (vide pour un nouvel artiste), avec ses shows et les étiquettes à cocher. */
export async function artistSheet(admin: Admin, artist: AdminArtist | null): Promise<ArtistSheet> {
  const choices = await admin.artistChoices();
  return {
    id: artist?.id ?? null,
    status: artist?.status ?? "draft",
    version: artist?.version ?? "",
    created: artist ? parisDateTime(artist.createdAt) : null,
    updated: artist ? parisDateTime(artist.updatedAt) : null,
    form: artist ? artistFormOf(artist) : emptyArtistForm(),
    photo: artist?.photo ?? null,
    radiocultArtistId: artist?.radiocultArtistId ?? null,
    shows: (artist?.shows ?? []).map((show) => ({ id: show.id, title: show.title, type: show.type, status: show.status, date: show.broadcastAt ? parisDay(show.broadcastAt) : "sans date" })),
    events: artist?.events ?? 0,
    facets: choices.facets,
    tags: choices.tags,
  };
}

/** Les étiquettes et les filtres, et l'onglet à montrer : celui demandé s'il existe, sinon le premier filtre. */
export function tagsData(taxonomy: Taxonomy, wanted: string | null): TagsData {
  const current = wanted === UNPLACED || taxonomy.facets.some((facet) => facet.slug === wanted) ? wanted! : (taxonomy.facets[0]?.slug ?? UNPLACED);
  return { ...taxonomy, current };
}

/** Les vidéos de fond, dans l'ordre : le numéro de chaîne compte celles de la rotation. */
export function clipsData(clips: AdminClip[]): ClipsData {
  let channel = 0;
  return {
    uploads: blobReady(),
    maxBytes: MAX_VIDEO_BYTES,
    clips: clips.map((clip) => ({
      id: clip.id,
      title: clip.title,
      videoUrl: clip.videoUrl,
      posterUrl: clip.posterUrl,
      channel: clip.status === "published" ? ++channel : null,
      status: clip.status,
      origin: clip.videoUrl.startsWith("/") ? "site" : "upload",
      facts: [
        clip.durationSeconds && formatTimecode(clip.durationSeconds),
        clip.width && clip.height && `${clip.width} × ${clip.height}`,
        clip.sizeBytes && megabytes(clip.sizeBytes),
      ]
        .filter(Boolean)
        .join(" · "),
      added: parisDay(clip.createdAt),
    })),
  };
}

/** L'application demande un écran ou envoie une fiche (fetch) : elle attend du JSON, pas une page. */
export const wantsJson = (request: Request) => (request.headers.get("accept") ?? "").includes("application/json");

/** Une réponse JSON de l'admin. */
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
