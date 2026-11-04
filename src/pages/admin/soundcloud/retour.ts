/**
 * Le retour de SoundCloud après « Relier SoundCloud » (cms/README.md, 9.14), un admin seulement : l'état doit être celui
 * du cookie (sinon la demande ne vient pas de nous), puis le code est échangé contre les jetons, avec le verifier, et le
 * compte gardé (private.soundcloud_account). On revient à l'accueil de l'admin, qui dit comment ça s'est passé.
 */
import { relierSoundCloud } from "@parabole/cms";
import type { APIRoute } from "astro";
import { database } from "../../../lib/cms";
import { soundcloudApp } from "../../../lib/soundcloud";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url, cookies, redirect }) => {
  if (locals.member?.role !== "admin") return new Response("Seul un admin relie le compte SoundCloud.", { status: 403 });
  const saved = cookies.get("soundcloud-pkce")?.value ?? "";
  cookies.delete("soundcloud-pkce", { path: "/admin/soundcloud" });
  const [state, verifier] = saved.split(".");
  if (url.searchParams.get("error")) return redirect("/admin?soundcloud=refus", 303);
  const code = url.searchParams.get("code");
  const app = soundcloudApp(url.origin);
  if (!app) return redirect("/admin?soundcloud=reglages", 303);
  if (!state || !verifier || !code || url.searchParams.get("state") !== state) return redirect("/admin?soundcloud=echec", 303);
  try {
    const { username } = await relierSoundCloud(await database(), app, { code, verifier, memberId: locals.member.userId });
    console.log(`SoundCloud : compte « ${username} » relié par ${locals.member.name}.`);
    return redirect("/admin?soundcloud=relie", 303);
  } catch (failure) {
    console.error("SoundCloud : le compte n'a pas pu être relié", failure);
    return redirect("/admin?soundcloud=echec", 303);
  }
};
