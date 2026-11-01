/**
 * La garde de l'admin (cms/README.md, section 9.1). Toute adresse sous /admin passe par ici :
 *   - la session est vérifiée auprès de Supabase Auth à chaque requête (getUser), jamais crue sur parole ;
 *   - la fiche d'équipe est lue sous le rôle de la personne (createAdmin) : les règles d'accès de la base décident ;
 *   - sans session : vers la connexion ; avec une session mais sans fiche : « Ce compte ne fait pas partie de
 *     l'équipe ».
 * Les pages trouvent ensuite dans Astro.locals la personne connectée, sa fiche, et les fonctions de l'admin liées à
 * son identifiant vérifié. Le reste du site ne passe pas par la garde : ses pages restent statiques.
 */
import { createAdmin } from "@parabole/cms";
import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { DATABASE_URL } from "astro:env/server";
import { defineMiddleware } from "astro:middleware";
import { safeReturn, seeOther } from "./lib/admin/paths";
import { missingAuthSettings, supabaseFor } from "./lib/admin/supabase";
import { database } from "./lib/cms";

/** Les pages ouvertes sans fiche d'équipe : la connexion, la déconnexion, et le refus lui-même. */
const OUTSIDE_TEAM = new Set(["/admin/connexion", "/admin/deconnexion", "/admin/refus"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname.replace(/\/+$/, "");
  if (path !== "/admin" && !path.startsWith("/admin/")) return next();
  return privately(await guard(context, path, next));
});

async function guard(context: APIContext, path: string, next: (rewrite?: string) => Promise<Response>): Promise<Response> {
  // En ligne, la base est forcément celle de Supabase (PGlite n'a pas de disque durable sur Vercel).
  const missing = [...missingAuthSettings(), ...(process.env.VERCEL && !DATABASE_URL ? ["DATABASE_URL"] : [])];
  if (missing.length)
    return unavailable(context, next, `Il manque ${missing.length > 1 ? "les réglages" : "le réglage"} ${missing.join(", ")} (Vercel, ou .env en local).`);

  const supabase = supabaseFor(context);
  context.locals.supabase = supabase;
  const { data, error } = await supabase.auth.getUser();
  // Une session absente, expirée ou révoquée n'est pas une panne : on repasse par la connexion.
  if (error && !isAuthSessionMissingError(error) && !(isAuthApiError(error) && error.status < 500))
    return unavailable(context, next, "Supabase Auth ne répond pas : impossible de vérifier ta session.");
  const user = data.user;
  if (!user) {
    if (path === "/admin/connexion") return next();
    const back = path === "/admin" ? "" : `?suite=${encodeURIComponent(path + context.url.search)}`;
    return seeOther(`/admin/connexion${back}`);
  }

  context.locals.user = { id: user.id, email: user.email ?? "" };
  let admin;
  try {
    // L'identifiant vient de la session vérifiée ci-dessus : c'est sous lui que la base lit et écrit.
    admin = createAdmin(await database(), user.id);
    context.locals.member = (await admin.member()) ?? undefined;
  } catch (failure) {
    console.error("admin : base injoignable", failure);
    return unavailable(context, next, "La base du CMS ne répond pas.");
  }
  if (!context.locals.member) return OUTSIDE_TEAM.has(path) && path !== "/admin/connexion" ? next() : next("/admin/refus");
  context.locals.admin = admin;
  if (path === "/admin/connexion" || path === "/admin/refus") return seeOther(safeReturn(context.url.searchParams.get("suite")));
  return next();
}

/** Une page « indisponible », sous l'adresse demandée, avec la raison. */
function unavailable(context: APIContext, next: (rewrite?: string) => Promise<Response>, reason: string): Promise<Response> {
  context.locals.problem = reason;
  return next("/admin/indisponible");
}

/** Rien de l'admin ne se garde en cache ni ne s'indexe : chaque réponse dépend de la personne connectée. */
function privately(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
