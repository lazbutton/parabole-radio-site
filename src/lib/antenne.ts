/**
 * Les routes de l'antenne libre (src/pages/api/chat/, CHAT_EN_DIRECT.md, section 9), côté serveur : l'antenne du CMS
 * sur la base du site, la session anonyme de l'auditeur (un jeton dans un cookie, que seules ces routes reçoivent),
 * son adresse IP, la vérification Turnstile d'un nouveau pseudo, et des réponses JSON jamais gardées en cache.
 */
import { createAntenne, type Antenne } from "@parabole/cms";
import type { APIContext } from "astro";
import { TURNSTILE_SECRET_KEY } from "astro:env/server";
import { database } from "./cms";

export const COOKIE = "parabole_antenne";

/** L'antenne, sur la base du site (Supabase en ligne, PGlite en local). */
export const antenneDuSite = async (): Promise<Antenne> => createAntenne(await database());

/** Une réponse JSON, propre à chaque auditeur : rien en cache. */
export const reponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** Le jeton de la session anonyme, s'il y en a un. */
export const jetonDe = (context: APIContext) => context.cookies.get(COOKIE)?.value || null;

/**
 * Pose le jeton d'un nouveau pseudo : un an, illisible en JavaScript, envoyé seulement aux routes de l'antenne et
 * jamais par un autre site (SameSite=Lax : une page d'ailleurs ne peut pas écrire à la place de l'auditeur).
 */
export function poserJeton(context: APIContext, jeton: string) {
  context.cookies.set(COOKIE, jeton, {
    path: "/api/chat",
    httpOnly: true,
    sameSite: "lax",
    secure: context.url.protocol === "https:",
    maxAge: 365 * 24 * 60 * 60,
  });
}

/** L'adresse IP de l'auditeur : celle que Vercel transmet, ou celle de la connexion en local. */
export function ipDe(context: APIContext): string | null {
  const transmise = context.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  let ip = transmise || null;
  if (!ip)
    try {
      ip = context.clientAddress;
    } catch {
      ip = null;
    }
  // une adresse que Postgres lira comme inet, ou rien
  return ip && /^[0-9a-f:.]+$/i.test(ip) ? ip.replace(/^::ffff:/, "") : null;
}

/** Une écriture vient-elle bien d'une page du site ? (Le cookie SameSite le garantit déjà ; deux barrières.) */
export function memeOrigine(context: APIContext): boolean {
  const origine = context.request.headers.get("origin");
  return !origine || origine === context.url.origin;
}

/** Le corps JSON d'une écriture, ou null. */
export async function corpsDe(context: APIContext): Promise<Record<string, unknown> | null> {
  try {
    const corps = await context.request.json();
    return corps && typeof corps === "object" ? (corps as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** L'action du widget de l'antenne (src/scripts/antenne-supabase.ts) : un jeton d'un autre widget ne vaut rien ici. */
export const ACTION_TURNSTILE = "antenne";

/**
 * La vérification Turnstile d'un nouveau pseudo, ou d'une candidature (`action`, celle du widget de la page), si le site
 * en a une (TURNSTILE_SECRET_KEY) : rend la fonction à appeler, ou undefined. Le jeton doit venir du widget de cette
 * page, sur la page même qui l'envoie : `hote`, celui de la requête (la page et l'API sont sur la même origine,
 * memeOrigine). Un jeton fait sur localhost ne passe donc pas en ligne. Une panne de Cloudflare refuse : seul un nouveau
 * pseudo attend, les autres écrivent ; une candidature attend, ses réponses restent dans la page.
 */
export function verificationHumaine(jeton: unknown, ip: string | null, hote: string, action = ACTION_TURNSTILE): (() => Promise<boolean>) | undefined {
  if (!TURNSTILE_SECRET_KEY) return undefined;
  return async () => {
    if (typeof jeton !== "string" || !jeton || jeton.length > 2048) return false;
    const corps = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY!, response: jeton });
    if (ip) corps.set("remoteip", ip);
    try {
      const reponseCloudflare = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: corps, signal: AbortSignal.timeout(10_000) });
      if (!reponseCloudflare.ok) throw new Error(`siteverify ${reponseCloudflare.status}`);
      const verdict = (await reponseCloudflare.json()) as { success?: boolean; action?: string; hostname?: string };
      return verdict.success === true && verdict.action === action && verdict.hostname === hote;
    } catch (panne) {
      console.error(`${action} : Turnstile ne répond pas, la vérification est refusée`, panne);
      return false;
    }
  };
}
