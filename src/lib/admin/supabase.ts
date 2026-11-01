/**
 * Supabase Auth pour l'admin, côté serveur seulement : la connexion de l'équipe (adresse et mot de passe) et sa
 * session, gardée en cookies par @supabase/ssr. Le navigateur ne parle jamais à Supabase : il n'a ni client ni clé.
 *
 * Les cookies de session ne valent que pour /admin (le site public n'en reçoit aucun), ne se lisent pas en
 * JavaScript (httpOnly) et ne partent pas vers un autre site (SameSite=Lax).
 */
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from "astro:env/server";

/** Ce qui manque pour que la connexion marche, ou rien. */
export const missingAuthSettings = (): string[] =>
  [!PUBLIC_SUPABASE_URL && "PUBLIC_SUPABASE_URL", !PUBLIC_SUPABASE_PUBLISHABLE_KEY && "PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter((name) => name !== false);

/** Un client Supabase pour cette requête : il lit la session dans ses cookies et y écrit la nouvelle. */
export function supabaseFor(context: Pick<APIContext, "request" | "cookies" | "url">): SupabaseClient {
  const secure = context.url.protocol === "https:";
  return createServerClient(PUBLIC_SUPABASE_URL!, PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { path: "/admin", sameSite: "lax", httpOnly: true, secure },
    cookies: {
      getAll: () => parseCookieHeader(context.request.headers.get("cookie") ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) context.cookies.set(name, value, options);
      },
    },
  });
}
