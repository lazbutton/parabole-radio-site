/**
 * L'API de Radio Cult (https://www.radiocult.fm/docs/api), où tourne Parabole en attendant BUTTON : la station, sa
 * clé publishable (PUBLIC_RADIOCULT_KEY, astro.config.mjs), qui n'ouvre que la lecture, et une lecture. Deux usages :
 * l'adaptateur de la station (station/radiocult.ts), pour le direct, la programmation et l'historique du site ;
 * l'import de la programmation dans le CMS (admin/imports.ts).
 */
import { PUBLIC_RADIOCULT_KEY } from "astro:env/client";

export const STATION = "parabole-radio-b02d5385";
export const ORIGIN = "https://api.radiocult.fm";
/** La clé publishable, ou vide : le direct, la programmation et l'historique répondent sans elle, pas les artistes. */
export const KEY = PUBLIC_RADIOCULT_KEY || "";

/** Lit une adresse de l'API de la station (« /schedule/live »…), 8 secondes au plus par défaut. Une erreur HTTP lève une exception. */
export async function radiocult(path: string, { timeout = 8000 } = {}): Promise<any> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (KEY) headers["x-api-key"] = KEY;
  const answer = await fetch(`${ORIGIN}/api/station/${STATION}${path}`, { headers, signal: AbortSignal.timeout(timeout) });
  if (!answer.ok) throw new Error(`Radio Cult ${path.split("?")[0]} : HTTP ${answer.status}`);
  return answer.json();
}
