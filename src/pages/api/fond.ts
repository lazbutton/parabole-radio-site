/**
 * GET /api/fond : les vidéos de fond de la rotation, dans l'ordre de la liste de l'admin (Vidéos de fond), au format
 * de la playlist du fond, et le filtre cathodique réglé au même écran (allumé ou non, intensité en pour cent) :
 * { clips: [{ src, titre?, poster? }], crt: { on, strength } }. Le cache de Vercel la garde 30 secondes, puis la
 * ressert le temps de la redemander ; les navigateurs, eux, la redemandent à chaque visite (sans quoi ils resserviraient
 * leur copie, comme le permet stale-while-revalidate). Un changement fait dans l'admin arrive ainsi sur le site en une
 * minute environ. Base injoignable (ou pas encore migrée) : 502, et le fond prend la liste de secours de
 * src/scripts/settings.ts. Le réglage du filtre illisible (table pas encore migrée) : le filtre d'origine, allumé à 100 %.
 */
import { createReader } from "@parabole/cms";
import type { APIRoute } from "astro";
import { json } from "../../lib/cache";
import { database } from "../../lib/cms";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    // Les clips ne sont pas dans le seau des images : son adresse ne sert pas ici.
    const cms = createReader(await database(), { mediaBaseUrl: "" });
    const [clips, look] = await Promise.all([
      cms.listBackgroundClips(),
      cms.getSiteLook().catch((failure) => {
        console.error("api/fond : le réglage du filtre cathodique est illisible", failure);
        return { crtFilter: true, crtStrength: 100 };
      }),
    ]);
    const response = json(
      {
        clips: clips.map(({ src, title, poster }) => ({ src, ...(title ? { titre: title } : {}), ...(poster ? { poster } : {}) })),
        crt: { on: look.crtFilter, strength: look.crtStrength },
      },
      "public, max-age=0, must-revalidate",
    );
    response.headers.set("Vercel-CDN-Cache-Control", "max-age=30, stale-while-revalidate=300");
    return response;
  } catch (failure) {
    console.error("api/fond : la liste des vidéos de fond est illisible", failure);
    return json({ error: "unavailable" }, "no-store", 502);
  }
};
