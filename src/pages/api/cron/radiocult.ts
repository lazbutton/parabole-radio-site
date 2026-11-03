/**
 * GET /api/cron/radiocult : l'import de la programmation Radio Cult (cms/README.md, 9.4), lancé chaque nuit par la
 * tâche planifiée de Vercel (vercel.json, vers 6 h ou 7 h à Paris). Vercel envoie « Authorization: Bearer
 * <CRON_SECRET> » : sans ce réglage, ou avec un autre en-tête, rien ne se passe. L'import écrit avec la connexion du
 * serveur et ne crée que des brouillons ; son résumé va dans les journaux de Vercel et au journal du CMS, que relit
 * l'accueil de l'admin.
 */
import { importRadioCult } from "@parabole/cms";
import type { APIRoute } from "astro";
import { CRON_SECRET } from "astro:env/server";
import { timingSafeEqual } from "node:crypto";
import { importSummary, logImport, readProgramme } from "../../../lib/admin/imports";
import { json } from "../../../lib/cache";
import { database } from "../../../lib/cms";

export const prerender = false;

/** L'en-tête de Vercel, comparé en temps constant. */
function fromVercel(request: Request): boolean {
  const sent = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

export const GET: APIRoute = async ({ request }) => {
  if (!CRON_SECRET) {
    console.error("Radio Cult, import : CRON_SECRET n'est pas réglé dans Vercel, la tâche de nuit est refusée.");
    return json({ error: "not configured" }, "no-store", 503);
  }
  if (!fromVercel(request)) return json({ error: "unauthorized" }, "no-store", 401);
  try {
    const result = await importRadioCult(await database(), await readProgramme());
    logImport(result, "tâche de nuit");
    const { moved, gone } = result.report;
    return json({ ok: result.ok, summary: importSummary(result), moved: moved.length, gone: gone.length }, "no-store", result.ok ? 200 : 502);
  } catch (failure) {
    console.error("Radio Cult, import : la base du CMS ne répond pas", failure);
    return json({ ok: false, error: "database unavailable" }, "no-store", 500);
  }
};
