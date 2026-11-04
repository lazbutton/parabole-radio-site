/**
 * L'assemblage d'une playlist (cms/README.md, 9.13), le calcul seul : la frise et ses fondus, les gains, les
 * silences, la setlist minutée, le rapprochement des fichiers avec la liste, et la lecture des réponses de Deezer,
 * YouTube et SoundCloud (des réponses types, telles que leurs API les rendent).
 */
import { describe, expect, it } from "vitest";
import {
  crossfade,
  fadeInGain,
  fadeOutGain,
  isoDuration,
  listeDeezer,
  listeSoundCloud,
  listeYouTube,
  rapprocher,
  setlist,
  silences,
  timeline,
  words,
  youTubeDurations,
  youTubeIds,
} from "../src/assemblage.ts";

describe("la frise", () => {
  it("fait partir chaque morceau quand le précédent s'efface, et raccourcit le fondu d'un morceau court", () => {
    expect(crossfade(3, 200, 180)).toBe(3);
    expect(crossfade(3, 180, 4)).toBe(2);
    expect(crossfade(0, 200, 180)).toBe(0);
    const { slots, total } = timeline([200, 180, 4], 3);
    expect(slots).toEqual([
      { start: 0, length: 200, fadeIn: 0, fadeOut: 3 },
      { start: 197, length: 180, fadeIn: 3, fadeOut: 2 },
      { start: 375, length: 4, fadeIn: 2, fadeOut: 0 },
    ]);
    expect(total).toBe(379);
    expect(timeline([], 3)).toEqual({ slots: [], total: 0 });
  });

  it("enchaîne à puissance constante : les deux gains au carré font toujours 1", () => {
    expect(fadeInGain(0)).toBe(0);
    expect(fadeOutGain(0)).toBe(1);
    expect(fadeInGain(1)).toBeCloseTo(1);
    expect(fadeOutGain(1)).toBeCloseTo(0);
    for (const progress of [0.1, 0.25, 0.5, 0.8]) expect(fadeInGain(progress) ** 2 + fadeOutGain(progress) ** 2).toBeCloseTo(1);
    expect(fadeInGain(2)).toBeCloseTo(1);
  });

  it("donne la setlist minutée, à la seconde", () => {
    const { slots } = timeline([200, 180, 4], 3);
    expect(setlist([{ artist: "A", title: "Un" }, { artist: "B ", title: "Deux" }, { artist: "C", title: " Trois" }], slots)).toEqual([
      { start: "0:00", artist: "A", title: "Un", hopperUrl: "" },
      { start: "3:17", artist: "B", title: "Deux", hopperUrl: "" },
      { start: "6:15", artist: "C", title: "Trois", hopperUrl: "" },
    ]);
  });
});

describe("les silences", () => {
  const rate = 1000;
  const sound = (silentStart: number, loud: number, silentEnd: number, noise = 0) => {
    const channel = new Float32Array(silentStart + loud + silentEnd).fill(noise);
    for (let i = silentStart; i < silentStart + loud; i++) channel[i] = 0.5 * Math.sin(i / 3);
    return channel;
  };

  it("trouve le silence du début et de la fin, sur tous les canaux", () => {
    expect(silences([sound(1000, 3000, 500)], rate)).toEqual({ start: 1000, end: 500 });
    // Le canal de droite commence plus tôt : on ne coupe pas ce qu'il joue.
    expect(silences([sound(1000, 3000, 500), sound(400, 3600, 500)], rate)).toEqual({ start: 400, end: 500 });
  });

  it("prend un souffle sous −60 dB pour du silence, et n'en retire pas plus de 5 s", () => {
    expect(silences([sound(800, 2000, 300, 0.0005)], rate)).toEqual({ start: 800, end: 300 });
    expect(silences([sound(8000, 2000, 7000)], rate)).toEqual({ start: 5000, end: 5000 });
    expect(silences([sound(8000, 2000, 7000)], rate, { max: 2 })).toEqual({ start: 2000, end: 2000 });
  });

  it("laisse tel quel un morceau tout entier silencieux", () => {
    expect(silences([new Float32Array(3000)], rate)).toEqual({ start: 0, end: 0 });
    expect(silences([new Float32Array(0)], rate)).toEqual({ start: 0, end: 0 });
  });
});

describe("le rapprochement des fichiers avec la liste", () => {
  it("ramène un texte à ses mots : accents, numéros, extensions, mentions de version, « feat. »", () => {
    expect(words("Étienne de Crécy – Prix Choc")).toEqual(["etienne", "de", "crecy", "prix", "choc"]);
    expect(words("01 - Kerri Chandler - Rain (Original Mix).mp3", 3)).toEqual(["kerri", "chandler", "rain"]);
    expect(words("Get Lucky - Radio Edit")).toEqual(["get", "lucky"]);
    expect(words("Daft Punk feat. Pharrell Williams - Get Lucky - Radio Edit.flac", 3)).toEqual(["daft", "punk", "get", "lucky"]);
    expect(words("Get Lucky [Remastered 2013] (feat. Pharrell)")).toEqual(["get", "lucky"]);
    // Un nom de fichier « Artiste - Titre » garde son titre, même s'il ressemble à une mention de version.
    expect(words("Daft Punk - Live.mp3", 3)).toEqual(["daft", "punk", "live"]);
  });

  it("range chaque fichier à sa place, signale les manquants et les fichiers en trop", () => {
    const list = [
      { artist: "Kerri Chandler", title: "Rain", duration: 410 },
      { artist: "Étienne de Crécy", title: "Prix choc", duration: 360 },
      { artist: "Daft Punk", title: "Get Lucky (feat. Pharrell Williams)", duration: 248 },
      { artist: "Energy 52", title: "Café Del Mar", duration: 540 },
    ];
    const files = [
      { id: "a", name: "02 - Etienne de Crecy - Prix Choc.wav", duration: 361 },
      { id: "b", name: "Daft Punk feat. Pharrell - Get Lucky - Radio Edit.mp3", duration: 249 },
      { id: "c", name: "kerri_chandler-rain_(original_mix).flac", duration: 409 },
      { id: "d", name: "Inconnu au bataillon.mp3", duration: 200 },
    ];
    expect(rapprocher(list, files)).toEqual({ places: ["c", "a", "b", null], missing: [3], unknown: ["d"] });
  });

  it("lit les étiquettes d'un fichier quand elles disent mieux que son nom", () => {
    const list = [{ artist: "Moodymann", title: "Shades Of Jae", duration: 380 }];
    const files = [{ id: "x", name: "track03.mp3", artist: "Moodymann", title: "Shades of Jae", duration: 381 }];
    expect(rapprocher(list, files).places).toEqual(["x"]);
  });

  it("départage par la durée deux fichiers qui se ressemblent", () => {
    const list = [
      { artist: "Ana", title: "Intro", duration: 60 },
      { artist: "Ana", title: "Intro", duration: 125 },
    ];
    const files = [
      { id: "long", name: "Ana - Intro.mp3", duration: 124 },
      { id: "court", name: "Ana - Intro (2).mp3", duration: 61 },
    ];
    expect(rapprocher(list, files).places).toEqual(["court", "long"]);
  });

  it("ne range pas un fichier qui n'a que l'artiste en commun", () => {
    const list = [{ artist: "Kerri Chandler", title: "Rain", duration: null }];
    expect(rapprocher(list, [{ id: "y", name: "Kerri Chandler - Bar A Thym.mp3", duration: null }])).toEqual({ places: [null], missing: [0], unknown: ["y"] });
  });
});

describe("la lecture des plateformes", () => {
  it("Deezer : la playlist et ses morceaux, la page suivante, l'erreur rendue avec le statut 200", () => {
    const page = listeDeezer({
      id: 908622995,
      title: "Dimanche matin",
      tracks: {
        data: [
          { id: 1, title: "Rain (Original Mix)", duration: 410, artist: { name: "Kerri Chandler" } },
          { id: 2, title: "", duration: 0, artist: { name: "?" } },
        ],
        next: "https://api.deezer.com/playlist/908622995/tracks?index=400",
      },
    });
    expect(page).toEqual({ title: "Dimanche matin", tracks: [{ artist: "Kerri Chandler", title: "Rain (Original Mix)", duration: 410 }], next: "https://api.deezer.com/playlist/908622995/tracks?index=400" });
    expect(listeDeezer({ data: [{ title: "Prix choc", duration: 360, artist: { name: "Étienne de Crécy" } }], total: 401 }).tracks).toHaveLength(1);
    expect(() => listeDeezer({ error: { type: "DataException", message: "no data", code: 800 } })).toThrow("no data");
  });

  it("YouTube : l'artiste et le titre tirés du titre de la vidéo ou de la chaîne, les durées, les vidéos supprimées sautées", () => {
    const body = {
      nextPageToken: "CDIQAA",
      items: [
        { snippet: { title: "Kerri Chandler - Rain (Official Video)", videoOwnerChannelTitle: "Kerri Chandler", resourceId: { videoId: "v1" } } },
        { snippet: { title: "Prix choc", videoOwnerChannelTitle: "Étienne de Crécy - Topic", resourceId: { videoId: "v2" } } },
        { snippet: { title: "Deleted video", resourceId: { videoId: "v3" } } },
        { snippet: { title: "Energy 52 – Café Del Mar [HD] | Lyrics", videoOwnerChannelTitle: "Chaîne", resourceId: { videoId: "v4" } } },
      ],
    };
    expect(youTubeIds(body)).toEqual(["v1", "v2", "v3", "v4"]);
    const durations = youTubeDurations({ items: [{ id: "v1", contentDetails: { duration: "PT6M50S" } }, { id: "v4", contentDetails: { duration: "PT1H2M5S" } }] });
    expect(listeYouTube(body, durations)).toEqual({
      title: "",
      tracks: [
        { artist: "Kerri Chandler", title: "Rain", duration: 410 },
        { artist: "Étienne de Crécy", title: "Prix choc", duration: null },
        { artist: "Energy 52", title: "Café Del Mar", duration: 3725 },
      ],
      next: null,
      nextToken: "CDIQAA",
    });
    expect(isoDuration("PT4M13S")).toBe(253);
    expect(isoDuration("P0D")).toBeNull();
    expect(() => listeYouTube({ error: { code: 404, message: "The playlist identified with the request's playlistId parameter cannot be found." } })).toThrow("cannot be found");
  });

  it("SoundCloud : l'artiste du morceau, du titre, ou du compte ; une playlist lue par pages ; un lien qui n'est pas une playlist", () => {
    const page = listeSoundCloud({
      kind: "playlist",
      title: "Sélection",
      track_count: 4,
      tracks_uri: "https://api.soundcloud.com/playlists/soundcloud:playlists:12345/tracks",
      tracks: [
        { title: "Rain", duration: 410_000, user: { username: "parabole" }, metadata_artist: "Kerri Chandler" },
        { title: "Shades Of Jae", duration: 397_000, user: { username: "kdj" }, publisher_metadata: { artist: "Moodymann" } },
        { title: "Étienne de Crécy - Prix choc", duration: 360_400, user: { username: "parabole" } },
        { title: "Café Del Mar", duration: 540_000, user: { username: "energy52" } },
      ],
    });
    expect(page).toEqual({
      title: "Sélection",
      tracks: [
        { artist: "Kerri Chandler", title: "Rain", duration: 410 },
        { artist: "Moodymann", title: "Shades Of Jae", duration: 397 },
        { artist: "Étienne de Crécy", title: "Prix choc", duration: 360 },
        { artist: "energy52", title: "Café Del Mar", duration: 540 },
      ],
      next: null,
    });
    // Une longue playlist ne rend qu'une partie de ses morceaux : on les lit par pages, depuis le premier.
    const partial = listeSoundCloud({ kind: "playlist", title: "Longue", track_count: 300, tracks_uri: "https://api.soundcloud.com/playlists/soundcloud:playlists:9/tracks", tracks: [{ title: "Rain" }] });
    expect(partial).toEqual({ title: "Longue", tracks: [], next: "https://api.soundcloud.com/playlists/soundcloud:playlists:9/tracks" });
    expect(listeSoundCloud({ collection: [{ title: "Rain", duration: 410_000, metadata_artist: "Kerri Chandler" }], next_href: "https://api.soundcloud.com/playlists/soundcloud:playlists:9/tracks?cursor=2" })).toEqual({
      title: "",
      tracks: [{ artist: "Kerri Chandler", title: "Rain", duration: 410 }],
      next: "https://api.soundcloud.com/playlists/soundcloud:playlists:9/tracks?cursor=2",
    });
    expect(listeSoundCloud({ collection: [], next_href: null }).next).toBeNull();
    expect(() => listeSoundCloud({ kind: "track", title: "Rain" })).toThrow("playlist");
    expect(() => listeSoundCloud({})).toThrow("playlist");
  });
});
