/**
 * Relier le compte SoundCloud de Parabole (cms/README.md, 9.14), un admin seulement : le départ de la connexion OAuth
 * 2.1 avec PKCE. Le verifier et l'état partent dans un cookie (httpOnly, 10 minutes, sur /admin/soundcloud seulement) ;
 * l'admin est envoyé chez SoundCloud, qui le renvoie sur /admin/soundcloud/retour.
 */
import { authorizeUrl, pkce } from "@parabole/cms";
import type { APIRoute } from "astro";
import { soundcloudApp } from "../../../lib/soundcloud";

export const prerender = false;

export const GET: APIRoute = ({ locals, url, cookies, redirect }) => {
  if (locals.member?.role !== "admin") return new Response("Seul un admin relie le compte SoundCloud.", { status: 403 });
  const app = soundcloudApp(url.origin);
  if (!app) return redirect("/admin?soundcloud=reglages", 303);
  const { verifier, challenge, state } = pkce();
  cookies.set("soundcloud-pkce", `${state}.${verifier}`, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/admin/soundcloud", maxAge: 600 });
  return redirect(authorizeUrl(app, { challenge, state }), 302);
};
