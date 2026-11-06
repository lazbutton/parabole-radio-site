/**
 * Les règles d'une candidature (cms/README.md, 9.17), partagées par la page /candidater, qui vérifie chaque écran avant
 * le suivant, et par le serveur, qui revérifie tout avant d'écrire : les mêmes règles et les mêmes messages des deux
 * côtés. Rien que du calcul, sans base : le navigateur l'importe par @parabole/cms/candidatures.
 */

/** Les types d'émission qu'on propose, dans l'ordre de la page. */
export const TYPES_CANDIDATURE = ["dj_set", "podcast", "playlist"] as const;
export type TypeCandidature = (typeof TYPES_CANDIDATURE)[number];

/** Le nom de chaque type, au pluriel, pour dire qu'il est complet. */
export const TYPES_AU_PLURIEL: Record<TypeCandidature, string> = { dj_set: "DJ sets", podcast: "podcasts", playlist: "playlists" };

export const NOM_MAX = 120;
export const VILLE_MAX = 80;
export const EMAIL_MAX = 200;
export const IDEE_MIN = 20;
export const IDEE_MAX = 800;
export const LIEN_MAX = 600;
/** Au plus, dans Ton style. */
export const STYLES_MAX = 3;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INSTA = /^[A-Za-z0-9._]{1,30}$/;

/** Un compte Instagram, d'où qu'on l'ait copié : « @nom », « nom », ou l'adresse de son profil. Vide s'il ne va pas. */
export function compteInsta(saisie: string): string {
  let nom = saisie.trim();
  const adresse = nom.match(/instagram\.com\/([^/?#\s]+)/i);
  if (adresse) nom = adresse[1]!;
  nom = nom.replace(/^@+/, "").replace(/\/+$/, "");
  return INSTA.test(nom) ? nom : "";
}

/** Une adresse web complète (https:// ajouté s'il manque), ou null si ce n'en est pas une. */
export function adresseWeb(saisie: string): string | null {
  const brut = saisie.trim();
  if (!brut || /\s/.test(brut)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(brut) ? brut : `https://${brut}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href.length <= LIEN_MAX ? url.href : null;
  } catch {
    return null;
  }
}

/** Le lien d'écoute est-il demandé ? Pour un set ou une playlist, oui ; pour un podcast, une idée peut suffire. */
export const lienRequis = (type: string) => type !== "podcast";

/** Ce que la page envoie : les champs tels quels. */
export type CandidatureForm = {
  type: string;
  prete: string;
  frequence: string;
  nom: string;
  ville: string;
  instagram: string;
  email: string;
  idee: string;
  lien: string;
  styles: string[];
};

/** Une candidature vérifiée, prête à écrire. */
export type CandidatureValues = {
  type: TypeCandidature;
  ready: boolean;
  /** Vrai : régulièrement ; faux : une fois ; null : rien dit. */
  regular: boolean | null;
  name: string;
  city: string | null;
  instagram: string | null;
  email: string | null;
  pitch: string;
  listenUrl: string | null;
  /** Les adresses des styles cochés (des groupes des filtres), trois au plus. */
  styles: string[];
};

/** Les erreurs, par champ : type, prete, nom, instagram, email, contact, idee, lien. */
export type CandidatureErrors = Record<string, string>;

/** Les champs de chaque écran de la page, pour y ramener l'erreur. */
export const CHAMPS_PAR_ECRAN: Record<1 | 2 | 3, string[]> = {
  1: ["type", "prete", "frequence"],
  2: ["nom", "ville", "instagram", "email", "contact"],
  3: ["idee", "lien", "styles"],
};

const texte = (valeur: unknown) => (typeof valeur === "string" ? valeur.trim() : "");

/** Vérifie une candidature, champ par champ : ses valeurs, ou ses erreurs. */
export function lireCandidature(form: CandidatureForm): { values: CandidatureValues | null; errors: CandidatureErrors } {
  const errors: CandidatureErrors = {};
  const type = texte(form.type);
  if (!(TYPES_CANDIDATURE as readonly string[]).includes(type)) errors.type = "Choisis ce que tu proposes.";
  const prete = texte(form.prete);
  if (prete !== "oui" && prete !== "non") errors.prete = "Dis-nous si ton émission est déjà enregistrée.";
  const frequence = texte(form.frequence);

  const nom = texte(form.nom).replace(/\s+/g, " ");
  if (nom.length < 2) errors.nom = nom ? "Ton nom d'artiste est un peu court." : "Indique ton nom d'artiste, ou celui de ton projet.";
  else if (nom.length > NOM_MAX) errors.nom = `Ton nom d'artiste est trop long (${NOM_MAX} caractères au plus).`;
  const ville = texte(form.ville).replace(/\s+/g, " ").slice(0, VILLE_MAX);

  const instaSaisi = texte(form.instagram);
  const insta = compteInsta(instaSaisi);
  if (instaSaisi && !insta) errors.instagram = "Ce compte n'a pas l'air juste : des lettres, des chiffres, des points et des _ seulement.";
  const email = texte(form.email);
  if (email && (!EMAIL.test(email) || email.length > EMAIL_MAX)) errors.email = "Cette adresse e-mail n'a pas l'air complète.";
  if (!instaSaisi && !email) errors.contact = "Laisse ton Instagram ou ton e-mail, pour qu'on puisse te répondre.";

  const idee = texte(form.idee);
  if (idee.length < IDEE_MIN) errors.idee = idee ? `Dis-nous-en un peu plus (${IDEE_MIN} caractères au moins).` : "Raconte-nous ton idée en quelques lignes.";
  else if (idee.length > IDEE_MAX) errors.idee = `Ton idée est un peu longue : ${IDEE_MAX} caractères au plus.`;

  const lienSaisi = texte(form.lien);
  const lien = adresseWeb(lienSaisi);
  if (lienSaisi && !lien) errors.lien = "Ce lien n'a pas l'air d'une adresse web.";
  else if (!lienSaisi && lienRequis(type))
    errors.lien = type === "playlist" ? "Ajoute le lien de ta playlist, pour qu'on l'écoute." : "Ajoute un lien vers un de tes mixes, pour qu'on t'écoute.";

  const styles = [...new Set((Array.isArray(form.styles) ? form.styles : []).map(texte).filter((slug) => slug && slug.length <= 80))].slice(0, STYLES_MAX);

  if (Object.keys(errors).length) return { values: null, errors };
  return {
    values: {
      type: type as TypeCandidature,
      ready: prete === "oui",
      regular: frequence === "reguliere" ? true : frequence === "une-fois" ? false : null,
      name: nom,
      city: ville || null,
      instagram: insta || null,
      email: email || null,
      pitch: idee,
      listenUrl: lien,
      styles,
    },
    errors,
  };
}
