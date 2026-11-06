/**
 * Les réglages du site public dans l'admin (écran Vidéos de fond) : le filtre cathodique posé sur tout le site,
 * allumé ou éteint, et sa force. Une seule ligne, posée par la migration ; l'équipe la change (la base refuse les
 * autres sans erreur, d'où la vérification du retour).
 */
import type { Tx } from "../access.ts";
import { getSiteLook, type SiteLook } from "../read/site.ts";
import { siteSettings } from "../schema.ts";
import type { NotSaved } from "./common.ts";

/** La force la plus faible et la plus forte du filtre, en pour cent (la base vérifie les mêmes bornes). */
export const CRT_STRENGTH = { min: 10, max: 200 } as const;

export { getSiteLook };

/** Change le filtre cathodique : allumé ou non, et sa force (arrondie, entre 10 et 200 %). */
export async function saveSiteLook(tx: Tx, change: Partial<SiteLook>): Promise<{ ok: true; look: SiteLook } | NotSaved> {
  const values: Partial<SiteLook> = {};
  if (change.crtFilter !== undefined) values.crtFilter = change.crtFilter === true;
  if (change.crtStrength !== undefined) {
    const strength = Math.round(Number(change.crtStrength));
    if (!Number.isFinite(strength) || strength < CRT_STRENGTH.min || strength > CRT_STRENGTH.max)
      return { ok: false, errors: { crtStrength: `La force du filtre va de ${CRT_STRENGTH.min} à ${CRT_STRENGTH.max} %.` } };
    values.crtStrength = strength;
  }
  if (!Object.keys(values).length) return { ok: true, look: await getSiteLook(tx) };
  const [saved] = await tx.update(siteSettings).set(values).returning({ crtFilter: siteSettings.crtFilter, crtStrength: siteSettings.crtStrength });
  return saved ? { ok: true, look: saved } : { ok: false, errors: { form: "Les réglages du site n'ont pas été enregistrés : ton compte n'a pas le droit de les changer." } };
}
