/**
 * La publication sur SoundCloud (cms/README.md, 9.14), sans SoundCloud : un faux réseau (fetch) et un faux seau. Le
 * corps multipart à l'octet près, le PKCE, le compte relié et la rotation de ses jetons, les émissions du matin,
 * l'envoi (la piste inscrite, la page publiée, les morceaux effacés), l'échec noté sans nouvel essai, jamais deux
 * envois de la même émission.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Connection, Db } from "../src/db.ts";
import { artist, audioFile, media, show, showArtist, tag, showTag, track } from "../src/schema.ts";
import { aPublier, descriptionOf, multipart, plainText, prendre, publier, tagListOf, trackIdOf, type PublishDeps } from "../src/soundcloud/index.ts";
import { authorizeUrl, challengeOf, compteSoundCloud, delierSoundCloud, jetonSoundCloud, relierSoundCloud, SoundCloudError, type SoundCloudApp } from "../src/soundcloud/oauth.ts";
import { freshDb } from "./helpers.ts";

const APP: SoundCloudApp = { clientId: "appli", clientSecret: "secret", redirectUri: "https://parabole.test/admin/soundcloud/retour" };
const NOV10 = new Date("2026-11-10T08:00:00Z");

/** Un faux réseau : chaque appel est noté, avec son corps lu en entier ; la réponse vient d'une table. */
function fakeNetwork(answers: (url: string, init: RequestInit, body: Uint8Array) => Response) {
  const calls: { url: string; init: RequestInit; body: Uint8Array }[] = [];
  const fetcher = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body ? new Uint8Array(await new Response(init.body as ConstructorParameters<typeof Response>[0]).arrayBuffer()) : new Uint8Array();
    calls.push({ url, init, body });
    return answers(url, init, body);
  }) as typeof fetch;
  return { fetcher, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const stream = (bytes: Uint8Array, piece = 3) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += piece) controller.enqueue(bytes.slice(at, at + piece));
      controller.close();
    },
  });

describe("le corps multipart", () => {
  it("s'écrit à l'octet près, avec sa longueur exacte", async () => {
    const audio = new TextEncoder().encode("ID3-son-du-set");
    const { body, length, type } = multipart(
      [
        { name: "track[title]", value: "Nuit club « d'essai »" },
        { name: "track[asset_data]", fileName: 'nuit "club".mp3', type: "audio/mpeg", size: audio.byteLength, open: () => stream(audio) },
      ],
      "FRONTIERE",
    );
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    expect(type).toBe("multipart/form-data; boundary=FRONTIERE");
    expect(bytes.byteLength).toBe(length);
    expect(text(bytes)).toBe(
      [
        "--FRONTIERE",
        'Content-Disposition: form-data; name="track[title]"',
        "",
        "Nuit club « d'essai »",
        "--FRONTIERE",
        'Content-Disposition: form-data; name="track[asset_data]"; filename="nuit %22club%22.mp3"',
        "Content-Type: audio/mpeg",
        "",
        "ID3-son-du-set",
        "--FRONTIERE--",
        "",
      ].join("\r\n"),
    );
  });

  it("s'arrête si un fichier ne fait pas la taille annoncée", async () => {
    const { body } = multipart([{ name: "f", fileName: "a.mp3", type: "audio/mpeg", size: 10, open: () => stream(new Uint8Array(4)) }]);
    await expect(new Response(body).arrayBuffer()).rejects.toThrow("taille annoncée");
  });
});

describe("la connexion", () => {
  it("calcule le défi PKCE comme la RFC 7636, et l'adresse d'autorisation", () => {
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const url = new URL(authorizeUrl(APP, { challenge: "defi", state: "etat" }));
    expect(url.origin + url.pathname).toBe("https://secure.soundcloud.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "appli", redirect_uri: APP.redirectUri, response_type: "code", code_challenge: "defi", code_challenge_method: "S256", state: "etat" });
  });
});

describe("le compte relié et la publication", () => {
  let connection: Connection;
  let db: Db;
  let refreshes = 0;

  /** Le réseau de SoundCloud, tel que les tests l'attendent. */
  let uploads = 4241;
  const soundcloud = (tracks: (body: Uint8Array) => Response = () => json({ urn: `soundcloud:tracks:${++uploads}`, permalink_url: `https://soundcloud.com/parabole/nuit-club-${uploads}`, duration: 7_190_400 }, 201)) =>
    fakeNetwork((url, _init, body) => {
      if (url === "https://secure.soundcloud.com/oauth/token") {
        const form = new URLSearchParams(text(body));
        if (form.get("grant_type") === "authorization_code") return json({ access_token: "acces-1", refresh_token: "renouv-1", expires_in: 3600, scope: "" });
        refreshes++;
        return form.get("refresh_token") === `renouv-${refreshes}` ? json({ access_token: `acces-${refreshes + 1}`, refresh_token: `renouv-${refreshes + 1}`, expires_in: 3600 }) : json({ error: "invalid_grant" }, 400);
      }
      if (url === "https://api.soundcloud.com/me") return json({ urn: "soundcloud:users:1724317019", username: "PARABOLE RADIO", permalink_url: "https://soundcloud.com/parabole-radio" });
      if (url === "https://api.soundcloud.com/tracks") return tracks(body);
      return json({ error: "inconnu" }, 404);
    });

  const deps = (fetcher: typeof fetch, now = NOV10): PublishDeps => ({
    app: APP,
    fetcher,
    readAudio: async () => ({ body: stream(new TextEncoder().encode("MP3")), size: 3 }),
    readCover: async () => new Uint8Array([0xff, 0xd8, 0xff]),
    siteUrl: "https://parabole.test",
    now: () => now,
  });

  /** Une émission avec son son, dans l'état voulu. */
  async function episode(values: Partial<typeof show.$inferInsert>, status: "received" | "approved" | "failed" | "sending" | "sent" = "approved") {
    const [row] = await db
      .insert(show)
      .values({ slug: `emission-${randomUUID().slice(0, 8)}`, title: "Nuit club", type: "dj_set", broadcastAt: new Date("2026-11-08T19:00:00Z"), durationSeconds: 7200, ...values })
      .returning({ id: show.id });
    const [file] = await db.insert(audioFile).values({ showId: row!.id, role: "main", key: `audio/2026/11/${randomUUID()}.mp3`, fileName: "set.mp3", mimeType: "audio/mpeg", sizeBytes: 3, status }).returning({ id: audioFile.id });
    return { showId: row!.id, fileId: file!.id };
  }

  beforeAll(async () => {
    connection = await freshDb();
    db = connection.db;
  });
  afterAll(() => connection?.close());

  it("relie le compte, ne montre jamais ses jetons, et renouvelle le jeton une seule fois par refresh token", async () => {
    await expect(jetonSoundCloud(db, APP, { fetcher: soundcloud().fetcher, now: NOV10 })).rejects.toThrow(SoundCloudError);
    const { fetcher, calls } = soundcloud();
    expect(await relierSoundCloud(db, APP, { code: "code", verifier: "verif", memberId: null, fetcher, now: NOV10 })).toEqual({ username: "PARABOLE RADIO" });
    const exchange = new URLSearchParams(text(calls[0]!.body));
    expect(Object.fromEntries(exchange)).toEqual({ grant_type: "authorization_code", client_id: "appli", client_secret: "secret", redirect_uri: APP.redirectUri, code_verifier: "verif", code: "code" });
    expect(await compteSoundCloud(db)).toEqual({ username: "PARABOLE RADIO", permalinkUrl: "https://soundcloud.com/parabole-radio", linkedAt: NOV10 });

    // Encore valable : pas d'appel ; périmé : un renouvellement, et le nouveau refresh token gardé.
    expect(await jetonSoundCloud(db, APP, { fetcher, now: new Date(NOV10.getTime() + 30 * 60_000) })).toBe("acces-1");
    const later = new Date(NOV10.getTime() + 2 * 3600_000);
    expect(await jetonSoundCloud(db, APP, { fetcher, now: later })).toBe("acces-2");
    expect(await jetonSoundCloud(db, APP, { fetcher, now: later })).toBe("acces-2");
    expect(await jetonSoundCloud(db, APP, { fetcher, now: new Date(later.getTime() + 2 * 3600_000) })).toBe("acces-3");
    expect(refreshes).toBe(2);
  });

  it("choisit les émissions du matin : son validé, diffusion finie, une date, pas encore de piste", async () => {
    const ready = await episode({});
    await episode({ broadcastAt: new Date("2026-11-10T07:30:00Z") });
    await episode({ broadcastAt: null });
    await episode({ soundcloudTrackId: "123" });
    await episode({}, "received");
    await episode({}, "failed");
    const shortOne = await episode({ broadcastAt: new Date("2026-11-10T06:00:00Z"), durationSeconds: 3600 });
    expect(await aPublier(db, NOV10)).toEqual([ready.showId, shortOne.showId]);
    await db.delete(show);
  });

  it("publie : la piste inscrite, la page publiée, les morceaux de la playlist effacés", async () => {
    const [dj] = await db.insert(artist).values({ name: "Secri", slug: `secri-${randomUUID().slice(0, 6)}`, role: "resident" }).returning({ id: artist.id });
    const [house] = await db.insert(tag).values({ name: "Deep house", slug: `deep-house-${randomUUID().slice(0, 6)}` }).returning({ id: tag.id });
    const [cover] = await db.insert(media).values({ key: `images/2026/11/${randomUUID()}-1600.webp`, mimeType: "image/webp", width: 1600, height: 1600 }).returning({ id: media.id });
    const { showId, fileId } = await episode({ type: "playlist", durationSeconds: null, coverId: cover!.id, description: "Deux heures de **house**, avec [Secri](https://parabole.test/residents/secri)." });
    await db.insert(showArtist).values({ showId, artistId: dj!.id, position: 0 });
    await db.insert(showTag).values({ showId, tagId: house!.id });
    await db.insert(track).values([
      { showId, position: 1, artist: "Kerri Chandler", title: "Rain", startSeconds: 0 },
      { showId, position: 2, artist: "Moodymann", title: "Shades Of Jae", startSeconds: 197 },
    ]);
    const partKey = `audio/2026/11/${randomUUID()}.flac`;
    await db.insert(audioFile).values({ showId, role: "part", position: 1, key: partKey, fileName: "01.flac", mimeType: "audio/flac", sizeBytes: 9, status: "received" });

    const { fetcher, calls } = soundcloud();
    const done = await publier(db, showId, deps(fetcher, new Date(NOV10.getTime() + 5 * 3600_000)));
    expect(done).toEqual({ ok: true, showId, trackId: "4242", url: "https://soundcloud.com/parabole/nuit-club-4242", removedKeys: [partKey] });

    const upload = calls.find((call) => call.url === "https://api.soundcloud.com/tracks")!;
    const headers = upload.init.headers as Record<string, string>;
    // Le jeton de la veille a expiré pile à cette heure : un nouveau a été demandé.
    expect(headers.Authorization).toBe("OAuth acces-4");
    expect(Number(headers["Content-Length"])).toBe(upload.body.byteLength);
    const sent = text(upload.body);
    for (const expected of [
      'name="track[title]"\r\n\r\nNuit club\r\n',
      'name="track[artist]"\r\n\r\nSecri\r\n',
      'name="track[sharing]"\r\n\r\npublic\r\n',
      'name="track[downloadable]"\r\n\r\nfalse\r\n',
      'name="track[tag_list]"\r\n\r\n"Deep house"\r\n',
      'name="track[release_date]"\r\n\r\n2026-11-08\r\n',
      'filename="',
      "Content-Type: image/jpeg",
    ])
      expect(sent).toContain(expected);
    expect(sent).toContain("Deux heures de house, avec Secri (https://parabole.test/residents/secri).\n\nTracklist\n0:00 Kerri Chandler – Rain\n3:17 Moodymann – Shades Of Jae\n\nSur Parabole Radio : https://parabole.test/emissions/");

    const [after] = await db.select({ status: show.status, trackId: show.soundcloudTrackId, url: show.soundcloudUrl, duration: show.durationSeconds }).from(show).where(eq(show.id, showId));
    expect(after).toEqual({ status: "published", trackId: "4242", url: "https://soundcloud.com/parabole/nuit-club-4242", duration: 7190 });
    const files = await db.select({ id: audioFile.id, status: audioFile.status, sentAt: audioFile.sentAt }).from(audioFile).where(eq(audioFile.showId, showId));
    expect(files).toEqual([{ id: fileId, status: "sent", sentAt: expect.any(Date) }]);
    // Partie : plus rien à prendre.
    expect(await prendre(db, showId)).toBeNull();
  });

  it("ne prend jamais deux fois la même émission, sauf un envoi interrompu", async () => {
    const { showId } = await episode({});
    expect(await prendre(db, showId)).toMatchObject({ showId });
    expect(await prendre(db, showId)).toBeNull();
    // Toujours « en route » après un quart d'heure : l'envoi s'est interrompu, « Publier maintenant » le reprend.
    expect(await prendre(db, showId, new Date(Date.now() + 5 * 60_000))).toBeNull();
    expect(await prendre(db, showId, new Date(Date.now() + 16 * 60_000))).toMatchObject({ showId });
  });

  it("note un refus avec sa raison, sans nouvel essai le lendemain ; « Publier maintenant » peut réessayer", async () => {
    const { showId, fileId } = await episode({});
    const { fetcher } = soundcloud(() => json({ errors: [{ error_message: "Upload quota exceeded" }] }, 403));
    const failed = await publier(db, showId, deps(fetcher, new Date(NOV10.getTime() + 5 * 3600_000)));
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/Upload quota exceeded.*Artist Pro/) });
    const [file] = await db.select({ status: audioFile.status, error: audioFile.error }).from(audioFile).where(eq(audioFile.id, fileId));
    expect(file).toEqual({ status: "failed", error: expect.stringMatching(/Upload quota exceeded/) });
    expect(await aPublier(db, NOV10)).not.toContain(showId);

    // En privé, la page n'est pas publiée.
    const retried = await publier(db, showId, deps(soundcloud().fetcher, new Date(NOV10.getTime() + 5 * 3600_000)), { sharing: "private" });
    expect(retried).toMatchObject({ ok: true });
    const [row] = await db.select({ status: show.status }).from(show).where(eq(show.id, showId));
    expect(row!.status).toBe("draft");
  });

  it("met en forme la description et les étiquettes, et lit l'identifiant de la piste", () => {
    expect(plainText("## Titre\n\n**Gras** et *italique*, [un lien](https://ex.test) et `code`.\n\n\n\n> cité")).toBe("Titre\n\nGras et italique, un lien (https://ex.test) et code.\n\ncité");
    const current = { slug: "nuit", description: null, tracks: [], tags: [{ id: "1", name: "Disco" }, { id: "2", name: "Deep house" }] } as unknown as Parameters<typeof descriptionOf>[0];
    expect(descriptionOf(current, "https://parabole.test")).toBe("Sur Parabole Radio : https://parabole.test/emissions/nuit");
    expect(tagListOf(current)).toBe('Disco "Deep house"');
    expect(trackIdOf({ urn: "soundcloud:tracks:99" })).toBe("99");
    expect(trackIdOf({ id: 12 })).toBe("12");
    expect(trackIdOf({})).toBeNull();
  });

  it("délie le compte", async () => {
    await delierSoundCloud(db);
    expect(await compteSoundCloud(db)).toBeNull();
  });
});
