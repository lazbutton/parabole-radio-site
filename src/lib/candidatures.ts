/**
 * Les candidatures (/candidater, cms/README.md, 9.17), côté serveur : le CMS des candidatures sur la base du site (le
 * dépôt, les réglages, les styles à cocher).
 */
import { createCandidatures, type Candidatures } from "@parabole/cms";
import { database } from "./cms";

export const candidaturesDuSite = async (): Promise<Candidatures> => createCandidatures(await database());

/** L'action du widget Turnstile de la page : un jeton d'un autre widget (celui de l'antenne) ne vaut rien ici. */
export const ACTION_CANDIDATURE = "candidature";
