/**
 * GET /api/cron/soundcloud : la publication du matin (cms/README.md, 9.14), lancée chaque jour par la tâche planifiée
 * de Vercel (vercel.json, l'heure d'après l'import Radio Cult). Vercel envoie « Authorization: Bearer <CRON_SECRET> ».
 *
 * Les émissions validées et diffusées partent l'une après l'autre, tant qu'il reste du temps à la fonction (200 s sur
 * ses 300) : un MP3 de 750 Mo passe du seau à SoundCloud en quelques dizaines de secondes. S'il en reste, la tâche
 * lance un nouvel appel d'elle-même (même en-tête, `?tour=n`, 20 tours au plus) sans l'attendre : il a ses propres
 * 300 s. Un échec est noté sur le son (« failed ») et n'est pas réessayé : il s'affiche à l'accueil de l'admin. Sans
 * compte relié, rien ne part (et rien n'est marqué en échec). Au premier tour, les émissions déjà parties sans durée la
 * reçoivent de SoundCloud (completerDurees).
 */
import { aPublier, completerDurees, compteSoundCloud, publier, type Published } from "@parabole/cms";
import { waitUntil } from "@vercel/functions";
import type { APIRoute } from "astro";
import { CRON_SECRET } from "astro:env/server";
import { json } from "../../../lib/cache";
import { database } from "../../../lib/cms";
import { cronReady, fromVercel } from "../../../lib/cron";
import { removeFiles } from "../../../lib/r2";
import { publishDeps, soundcloudApp } from "../../../lib/soundcloud";

export const prerender = false;

const ROUNDS = 20;
const BUDGET = 200_000;

export const GET: APIRoute = async ({ request, url }) => {
  if (!cronReady()) {
    console.error("SoundCloud, publication : CRON_SECRET n'est pas réglé dans Vercel, la tâche est refusée.");
    return json({ error: "not configured" }, "no-store", 503);
  }
  if (!fromVercel(request)) return json({ error: "unauthorized" }, "no-store", 401);
  const app = soundcloudApp();
  if (!app) return json({ skipped: "SOUNDCLOUD_CLIENT_ID ou SOUNDCLOUD_CLIENT_SECRET manque" }, "no-store", 200);
  const round = Math.min(Math.max(Number(url.searchParams.get("tour")) || 1, 1), ROUNDS);
  const started = Date.now();
  try {
    const db = await database();
    if (!(await compteSoundCloud(db))) return json({ skipped: "SoundCloud n'est pas relié" }, "no-store", 200);
    const results: Published[] = [];
    while (Date.now() - started < BUDGET) {
      const [next] = await aPublier(db, new Date(), 1);
      if (!next) break;
      const done = await publier(db, next, publishDeps(app), { sharing: "public" });
      // Prise ailleurs entre-temps (« Publier maintenant ») : on s'arrête là plutôt que de tourner sur elle.
      if (!done) break;
      results.push(done);
      if (done.ok) await removeFiles(done.removedKeys);
      console.log(done.ok ? `SoundCloud, publication : émission ${done.showId} publiée (${done.url}).` : `SoundCloud, publication : émission ${done.showId} en échec : ${done.error}`);
    }
    // Les durées manquantes, au premier tour seulement : une erreur ici n'empêche pas la suite.
    const durations =
      round === 1
        ? await completerDurees(db, publishDeps(app)).catch((failure: unknown) => {
            console.error("SoundCloud, durées : lecture impossible", failure);
            return 0;
          })
        : 0;
    if (durations) console.log(`SoundCloud, durées : ${durations} émission(s) complétée(s).`);
    const more = (await aPublier(db, new Date(), 1)).length > 0;
    if (more && results.length && round < ROUNDS) {
      // L'appel suivant est lancé, pas attendu : trois secondes pour qu'il parte, puis cette fonction s'arrête.
      const following = new URL(`/api/cron/soundcloud?tour=${round + 1}`, url.origin);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      waitUntil(
        fetch(following, { headers: { Authorization: `Bearer ${CRON_SECRET}` }, signal: controller.signal })
          .then(() => undefined, () => undefined)
          .finally(() => clearTimeout(timer)),
      );
    }
    return json({ round, published: results.filter((one) => one.ok).length, failed: results.filter((one) => !one.ok).length, durations, more }, "no-store", 200);
  } catch (failure) {
    console.error("SoundCloud, publication : la base du CMS ne répond pas", failure);
    return json({ ok: false, error: "database unavailable" }, "no-store", 500);
  }
};
