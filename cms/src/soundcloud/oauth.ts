/**
 * Le compte SoundCloud de Parabole (cms/README.md, 9.14) : relié une fois par un admin, en OAuth 2.1 avec PKCE, puis
 * gardé dans private.soundcloud_account (une ligne, hors de l'API). Le jeton d'accès dure une heure ; chaque refresh
 * token ne sert qu'une fois : le nouveau est gardé tout de suite, la ligne verrouillée (FOR UPDATE) pour que deux envois
 * ne renouvellent pas en même temps, ce qui grillerait le compte. La connexion du site écrit ici en propriétaire ; les
 * jetons ne sortent jamais du serveur.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../db.ts";

export const AUTHORIZE_URL = "https://secure.soundcloud.com/authorize";
export const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
export const API_URL = "https://api.soundcloud.com";

/** L'appli SoundCloud de Parabole : son identifiant, son secret, son adresse de retour (/admin/soundcloud/retour). */
export type SoundCloudApp = { clientId: string; clientSecret: string; redirectUri: string };

/** Une erreur à dire à l'équipe telle quelle. */
export class SoundCloudError extends Error {
  override name = "SoundCloudError";
}

/** Les lignes d'un tx.execute() : PGlite les range dans « rows », postgres-js les rend directement. */
const lignes = <T>(resultat: unknown): T[] => (Array.isArray(resultat) ? resultat : (resultat as { rows: T[] }).rows);

/** Une date dans du SQL écrit à la main : en texte ISO, car Drizzle laisse postgres-js passer les dates telles quelles. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** Le code_challenge d'un code_verifier (S256) : le SHA-256 du verifier, en base64url. */
export const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Un départ de connexion : le verifier (gardé en cookie), son challenge, et l'état (contre la falsification). */
export function pkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: challengeOf(verifier), state: randomBytes(24).toString("base64url") };
}

/** L'adresse où l'admin autorise l'appli à publier sur le compte. */
export function authorizeUrl(app: SoundCloudApp, { challenge, state }: { challenge: string; state: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  return url.href;
}

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

async function askToken(fetcher: typeof fetch, form: Record<string, string>): Promise<Tokens> {
  const answer = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json; charset=utf-8", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body = (await answer.json().catch(() => ({}))) as Partial<Tokens> & { error?: string; error_description?: string };
  if (answer.ok && typeof body.access_token === "string") return body as Tokens;
  if (answer.status === 400 || answer.status === 401) throw new SoundCloudError("Le lien avec SoundCloud a expiré ou a été retiré : un admin le relie de nouveau depuis l'accueil.");
  throw new SoundCloudError(`SoundCloud ne donne pas de jeton (${answer.status}) : réessaie dans un moment.`);
}

const expiry = (tokens: Tokens, now: Date) => new Date(now.getTime() + Math.max(60, tokens.expires_in ?? 3600) * 1000);

/**
 * Relie le compte : échange le code reçu au retour contre les jetons, lit le compte (/me) et garde le tout, à la place
 * d'un compte relié avant. Rend le nom du compte.
 */
export async function relierSoundCloud(
  db: Db,
  app: SoundCloudApp,
  { code, verifier, memberId, fetcher = fetch, now = new Date() }: { code: string; verifier: string; memberId: string | null; fetcher?: typeof fetch; now?: Date },
): Promise<{ username: string }> {
  const tokens = await askToken(fetcher, { grant_type: "authorization_code", client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, code_verifier: verifier, code });
  if (!tokens.refresh_token) throw new SoundCloudError("SoundCloud n'a pas donné de jeton de renouvellement : réessaie de relier le compte.");
  const answer = await fetcher(`${API_URL}/me`, { headers: { Accept: "application/json; charset=utf-8", Authorization: `OAuth ${tokens.access_token}` } });
  const me = (await answer.json().catch(() => ({}))) as { urn?: string; id?: number; username?: string; permalink_url?: string };
  if (!answer.ok || !me.username) throw new SoundCloudError("SoundCloud ne dit pas quel compte a été relié : réessaie.");
  const urn = me.urn ?? `soundcloud:users:${me.id ?? "?"}`;
  await db.execute(sql`
    insert into private.soundcloud_account (id, user_urn, username, permalink_url, access_token, refresh_token, expires_at, scope, linked_by, linked_at, refreshed_at)
    values (1, ${urn}, ${me.username}, ${me.permalink_url ?? null}, ${tokens.access_token}, ${tokens.refresh_token}, ${at(expiry(tokens, now))}, ${tokens.scope ?? null}, ${memberId}, ${at(now)}, null)
    on conflict (id) do update set user_urn = excluded.user_urn, username = excluded.username, permalink_url = excluded.permalink_url,
      access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scope = excluded.scope,
      linked_by = excluded.linked_by, linked_at = excluded.linked_at, refreshed_at = null`);
  return { username: me.username };
}

/** Le compte relié : son nom, son adresse, depuis quand (jamais ses jetons). Null s'il n'y en a pas. */
export async function compteSoundCloud(db: Db): Promise<{ username: string; permalinkUrl: string | null; linkedAt: Date } | null> {
  const [row] = lignes<{ username: string; permalink_url: string | null; linked_at: Date | string }>(await db.execute(sql`select username, permalink_url, linked_at from private.soundcloud_account where id = 1`));
  return row ? { username: row.username, permalinkUrl: row.permalink_url, linkedAt: new Date(row.linked_at) } : null;
}

/** Délie le compte : ses jetons sont oubliés. */
export async function delierSoundCloud(db: Db): Promise<void> {
  await db.execute(sql`delete from private.soundcloud_account where id = 1`);
}

/**
 * Un jeton d'accès valable : celui gardé, s'il lui reste plus de deux minutes ; sinon un nouveau, demandé avec le
 * refresh token, gardé dans la même transaction, la ligne verrouillée.
 */
export async function jetonSoundCloud(db: Db, app: SoundCloudApp, { fetcher = fetch, now = new Date() }: { fetcher?: typeof fetch; now?: Date } = {}): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = lignes<{ access_token: string; refresh_token: string; expires_at: Date | string }>(
      await tx.execute(sql`select access_token, refresh_token, expires_at from private.soundcloud_account where id = 1 for update`),
    );
    if (!row) throw new SoundCloudError("SoundCloud n'est pas relié : un admin le relie depuis l'accueil de l'admin.");
    if (new Date(row.expires_at).getTime() - now.getTime() > 120_000) return row.access_token;
    const tokens = await askToken(fetcher, { grant_type: "refresh_token", client_id: app.clientId, client_secret: app.clientSecret, refresh_token: row.refresh_token });
    await tx.execute(sql`
      update private.soundcloud_account set access_token = ${tokens.access_token}, refresh_token = ${tokens.refresh_token ?? row.refresh_token},
        expires_at = ${at(expiry(tokens, now))}, scope = coalesce(${tokens.scope ?? null}, scope), refreshed_at = ${at(now)}
      where id = 1`);
    return tokens.access_token;
  });
}
