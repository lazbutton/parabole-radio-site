/**
 * GET /api/cron/radiocult : l'import de la programmation Radio Cult (cms/README.md, 9.4), lancé chaque nuit par la
 * tâche planifiée de Vercel (vercel.json, vers 6 h ou 7 h à Paris). Vercel envoie « Authorization: Bearer
 * <CRON_SECRET> » : sans ce réglage, ou avec un autre en-tête, rien ne se passe. L'import écrit avec la connexion du
 * serveur et ne crée que des brouillons ; son résumé va dans les journaux de Vercel et au journal du CMS, que relit
 * l'accueil de l'admin.
 *
 * Puis les envois des résidents (9.12), dans la même tâche, pour passer après l'import (sur Hobby, une tâche part à
 * n'importe quel moment de son heure : deux tâches de la même heure n'ont pas d'ordre) :
 *   - un envoi qui attendait son créneau s'y rattache, s'il n'en a qu'un possible ;
 *   - le ménage : les fichiers jamais arrivés dans le seau (en route depuis plus d'un jour) sont oubliés et effacés, un
 *     envoi vers SoundCloud bloqué passe en échec.
 * Enfin, les candidatures (9.17) : un refus est effacé six mois après la réponse.
 */
import { createCandidatures, createEnvois, importRadioCult, rattacherEnvois } from "@parabole/cms";
import type { APIRoute } from "astro";
import { importSummary, logImport, readProgramme } from "../../../lib/admin/imports";
import { removeImages } from "../../../lib/admin/storage";
import { json } from "../../../lib/cache";
import { database } from "../../../lib/cms";
import { cronReady, fromVercel } from "../../../lib/cron";
import { removeFiles } from "../../../lib/r2";

export const prerender = false;

/** Les envois des résidents, après l'import : rattachés à leur créneau quand il n'y a pas de doute, puis le ménage. */
async function envoisDeNuit(db: Awaited<ReturnType<typeof database>>) {
  try {
    const attached = await rattacherEnvois(db);
    await removeImages(attached.removedImages);
    const cleaned = await createEnvois(db).menage();
    await removeFiles(cleaned.keys);
    console.log(
      `Envois des résidents, tâche de nuit : ${attached.attached.length} rattaché(s) à leur créneau, ${attached.left} en attente de l'équipe, ${cleaned.keys.length} fichier(s) jamais arrivé(s) effacé(s), ${cleaned.stuck} envoi(s) SoundCloud bloqué(s).`,
    );
    return { attached: attached.attached.length, waiting: attached.left, forgotten: cleaned.keys.length, stuck: cleaned.stuck };
  } catch (failure) {
    console.error("Envois des résidents, tâche de nuit : échec", failure);
    return { error: "envois failed" };
  }
}

/** Les candidatures refusées depuis plus de six mois sont effacées. */
async function candidaturesDeNuit(db: Awaited<ReturnType<typeof database>>) {
  try {
    const effacees = await createCandidatures(db).menage();
    console.log(`Candidatures, tâche de nuit : ${effacees} refus de plus de six mois effacé(s).`);
    return { erased: effacees };
  } catch (failure) {
    console.error("Candidatures, tâche de nuit : échec", failure);
    return { error: "candidatures failed" };
  }
}

export const GET: APIRoute = async ({ request }) => {
  if (!cronReady()) {
    console.error("Radio Cult, import : CRON_SECRET n'est pas réglé dans Vercel, la tâche de nuit est refusée.");
    return json({ error: "not configured" }, "no-store", 503);
  }
  if (!fromVercel(request)) return json({ error: "unauthorized" }, "no-store", 401);
  try {
    const db = await database();
    const result = await importRadioCult(db, await readProgramme());
    logImport(result, "tâche de nuit");
    const { moved, gone } = result.report;
    const envois = await envoisDeNuit(db);
    const candidatures = await candidaturesDeNuit(db);
    return json({ ok: result.ok, summary: importSummary(result), moved: moved.length, gone: gone.length, envois, candidatures }, "no-store", result.ok ? 200 : 502);
  } catch (failure) {
    console.error("Radio Cult, import : la base du CMS ne répond pas", failure);
    return json({ ok: false, error: "database unavailable" }, "no-store", 500);
  }
};
