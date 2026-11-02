/**
 * Ce que partagent la grille des résidents, rendue par le serveur (src/pages/residents/index.astro), et son script
 * (src/scripts/residents.ts) : l'état de la grille, son adresse, et ce qui y entre. Le serveur rend la grille déjà
 * filtrée d'après l'adresse ; le script refait le même calcul sur place, sans recharger.
 */
import type { ArtistRole } from "@parabole/cms";

/** Résidents ou invités ; une activité (l'adresse d'un groupe du filtre Activité : « dj ») ; ce que cherche la loupe. */
export type EtatGrille = { role: ArtistRole; activite: string; q: string };

/** Un nom ou une recherche sans accents ni majuscules : « Éloïse » et « eloise » se rejoignent, « Œil » et « oeil ». */
export const normaliser = (texte: string) =>
  texte
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** L'état d'une adresse : /residents, ?role=invites, &activite=dj, &q=mar (la loupe de l'en-tête y mène). */
export function lireEtat(params: URLSearchParams): EtatGrille {
  return {
    role: params.get("role") === "invites" ? "guest" : "resident",
    activite: (params.get("activite") ?? "").trim().toLowerCase(),
    q: (params.get("q") ?? "").trim().slice(0, 80),
  };
}

/** L'adresse d'un état, la plus courte : /residents pour les résidents sans filtre. */
export function adresseDe(etat: EtatGrille): string {
  const params = new URLSearchParams();
  if (etat.q) params.set("q", etat.q);
  else {
    if (etat.role === "guest") params.set("role", "invites");
    if (etat.activite) params.set("activite", etat.activite);
  }
  const suite = params.toString();
  return "/residents" + (suite ? "?" + suite : "");
}

/**
 * Une carte entre-t-elle dans la grille ? Avec une recherche : son nom, quel que soit son rôle ou son activité. Sinon :
 * son rôle, et l'activité choisie (une activité vaut aussi pour les étiquettes de son groupe, `couvre`).
 */
export function correspond(carte: { role: ArtistRole; nom: string; etiquettes: string[] }, etat: EtatGrille, couvre: string[]): boolean {
  if (etat.q) return carte.nom.includes(normaliser(etat.q));
  return carte.role === etat.role && (!etat.activite || carte.etiquettes.some((etiquette) => couvre.includes(etiquette)));
}
