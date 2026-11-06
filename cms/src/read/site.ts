/** Les réglages du site public : le filtre cathodique posé sur tout le site, allumé ou non, et sa force. */
import type { Tx } from "../access.ts";
import { siteSettings } from "../schema.ts";

/** Le filtre cathodique : allumé ou non, et sa force en pour cent (100 : l'effet d'origine). */
export type SiteLook = { crtFilter: boolean; crtStrength: number };

/** Le site tel qu'il était avant les réglages : ce qu'on rend quand la ligne manque (migration pas appliquée). */
export const DEFAULT_SITE_LOOK: SiteLook = { crtFilter: true, crtStrength: 100 };

export async function getSiteLook(tx: Tx): Promise<SiteLook> {
  const [row] = await tx.select({ crtFilter: siteSettings.crtFilter, crtStrength: siteSettings.crtStrength }).from(siteSettings).limit(1);
  return row ?? DEFAULT_SITE_LOOK;
}
