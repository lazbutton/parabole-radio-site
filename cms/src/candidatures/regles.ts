/**
 * Les règles d'une candidature (cms/README.md, 9.17), partagées par la page /candidater, qui vérifie chaque écran avant
 * le suivant, et par le serveur, qui revérifie tout avant d'écrire : les mêmes règles et les mêmes messages des deux
 * côtés. Rien que du calcul, sans base : le navigateur l'importe par @parabole/cms/candidatures.
 *
 * Une candidature, c'est l'émission entière, prête à valider : son type, son titre, sa description, ses styles (écran
 * 1) ; l'artiste, sa bio, sa photo, ses liens (Instagram, SoundCloud ou autre), de quoi lui répondre (écran 2) ; le
 * son, sa tracklist, un mot pour l'équipe (écran 3). Le son est un MP3 ; une playlist peut venir à la place par son
 * lien. La tracklist se remplit en cases, l'artiste et le titre de chaque morceau : on la déclare à la SACEM. Elle est
 * demandée pour un DJ set et une playlist ; pour un podcast, souvent sans musique, elle est facultative.
 */
import { parseTracklist } from "../tracklist.ts";

/** Les types d'émission qu'on propose, dans l'ordre de la page. */
export const TYPES_CANDIDATURE = ["dj_set", "podcast", "playlist"] as const;
export type TypeCandidature = (typeof TYPES_CANDIDATURE)[number];

/** Le nom de chaque type, au pluriel, pour dire qu'il est complet. */
export const TYPES_AU_PLURIEL: Record<TypeCandidature, string> = { dj_set: "DJ sets", podcast: "podcasts", playlist: "playlists" };

export const TITRE_MAX = 120;
export const NOM_MAX = 120;
export const VILLE_MAX = 80;
export const EMAIL_MAX = 200;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 800;
export const BIO_MIN = 20;
export const BIO_MAX = 1000;
export const TRACKLIST_MAX = 20000;
export const MESSAGE_MAX = 2000;
export const LIEN_MAX = 600;
/** Au plus, dans Ses styles. */
export const STYLES_MAX = 3;
/** Au plus, tant de morceaux dans une tracklist, et tant de caractères pour un artiste ou un titre. */
export const MORCEAUX_MAX = 300;
export const MORCEAU_MAX = 200;

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

/** Une playlist peut venir par son lien, à la place du MP3. */
export const lienPossible = (type: string) => type === "playlist";

/** La tracklist est demandée (pour la SACEM), sauf pour un podcast, souvent sans musique. */
export const tracklistDemandee = (type: string) => type !== "podcast";

/** Un morceau de la tracklist : l'artiste et le titre, chacun dans sa case. */
export type Morceau = { artiste: string; titre: string };

const cellule = (texte: string) => texte.replace(/\s+/g, " ").trim();

/**
 * Les morceaux d'une tracklist envoyée : une ligne par morceau, « artiste<tabulation>titre » (les cases de la page).
 * Une ligne sans tabulation (un brouillon d'avant les cases, du texte collé) est lue comme une tracklist collée
 * (« 12:30 Artiste – Titre »). Les lignes vides sont oubliées ; une ligne à moitié remplie est rendue telle quelle,
 * pour que la règle la signale.
 */
export function lireMorceaux(texte: string): Morceau[] {
  const morceaux: Morceau[] = [];
  for (const ligne of texte.replace(/\r\n?/g, "\n").split("\n")) {
    if (ligne.includes("\t")) {
      const coupe = ligne.indexOf("\t");
      const morceau = { artiste: cellule(ligne.slice(0, coupe)), titre: cellule(ligne.slice(coupe + 1)) };
      if (morceau.artiste || morceau.titre) morceaux.push(morceau);
    } else if (ligne.trim()) {
      for (const lu of parseTracklist(ligne)) morceaux.push({ artiste: cellule(lu.artist), titre: cellule(lu.title) });
    }
  }
  return morceaux;
}

/** Les morceaux, une ligne chacun : « artiste<tabulation>titre ». */
export const ecrireMorceaux = (morceaux: Morceau[]) => morceaux.map(({ artiste, titre }) => `${cellule(artiste)}\t${cellule(titre)}`).join("\n");

/** Ce que la page envoie : les champs tels quels. */
export type CandidatureForm = {
  type: string;
  titre: string;
  description: string;
  styles: string[];
  nom: string;
  bio: string;
  ville: string;
  instagram: string;
  /** Le lien vers sa musique : SoundCloud ou autre (facultatif). */
  profil: string;
  email: string;
  /** Le lien d'une playlist envoyée sans MP3. */
  lien: string;
  /** Les morceaux, une ligne chacun : « artiste<tabulation>titre » (ecrireMorceaux). */
  tracklist: string;
  message: string;
};

/** Les écrans 1 et 2, vérifiés : de quoi ouvrir le dossier de l'envoi. */
export type DossierValues = {
  type: TypeCandidature;
  title: string;
  pitch: string;
  /** Les adresses des styles cochés (des groupes des filtres), trois au plus. */
  styles: string[];
  name: string;
  bio: string;
  city: string | null;
  instagram: string | null;
  /** Le lien vers sa musique, complet (https://). */
  profileUrl: string | null;
  email: string | null;
};

/** L'écran 3, vérifié. */
export type EnvoiValues = {
  /** Le lien d'une playlist envoyée sans MP3 ; null sinon. */
  listenUrl: string | null;
  /** Les morceaux, une ligne chacun (ecrireMorceaux), ou null s'il n'y en a pas. */
  tracklist: string | null;
  message: string | null;
};

/** Les erreurs, par champ : type, titre, description, nom, bio, instagram, profil, email, contact, son, lien, tracklist, message. */
export type CandidatureErrors = Record<string, string>;

/** Les champs de chaque écran de la page, pour y ramener l'erreur. */
export const CHAMPS_PAR_ECRAN: Record<1 | 2 | 3, string[]> = {
  1: ["type", "titre", "description", "styles"],
  2: ["nom", "bio", "photo", "ville", "instagram", "profil", "email", "contact"],
  3: ["son", "lien", "tracklist", "message"],
};

const texte = (valeur: unknown) => (typeof valeur === "string" ? valeur.replace(/\r\n?/g, "\n").trim() : "");
const ligne = (valeur: unknown) => texte(valeur).replace(/\s+/g, " ");

/** Les écrans 1 et 2 : l'émission et l'artiste. */
export function lireDossier(form: CandidatureForm): { values: DossierValues | null; errors: CandidatureErrors } {
  const errors: CandidatureErrors = {};
  const type = texte(form.type);
  if (!(TYPES_CANDIDATURE as readonly string[]).includes(type)) errors.type = "Choisis ce que tu proposes.";

  const titre = ligne(form.titre);
  if (titre.length < 2) errors.titre = titre ? "Ce titre est un peu court." : "Donne un titre à ton émission.";
  else if (titre.length > TITRE_MAX) errors.titre = `Ce titre est trop long (${TITRE_MAX} caractères au plus).`;

  const description = texte(form.description);
  if (description.length < DESCRIPTION_MIN)
    errors.description = description ? `Dis-nous-en un peu plus (${DESCRIPTION_MIN} caractères au moins).` : "Décris ton émission en quelques lignes.";
  else if (description.length > DESCRIPTION_MAX) errors.description = `C'est un peu long : ${DESCRIPTION_MAX} caractères au plus.`;

  const styles = [...new Set((Array.isArray(form.styles) ? form.styles : []).map(texte).filter((slug) => slug && slug.length <= 80))].slice(0, STYLES_MAX);

  const nom = ligne(form.nom);
  if (nom.length < 2) errors.nom = nom ? "Ton nom d'artiste est un peu court." : "Indique ton nom d'artiste, ou celui de ton projet.";
  else if (nom.length > NOM_MAX) errors.nom = `Ton nom d'artiste est trop long (${NOM_MAX} caractères au plus).`;

  const bio = texte(form.bio);
  if (bio.length < BIO_MIN) errors.bio = bio ? `Ta bio est un peu courte (${BIO_MIN} caractères au moins).` : "Présente-toi en quelques lignes : ce sera ta bio sur le site.";
  else if (bio.length > BIO_MAX) errors.bio = `Ta bio est un peu longue : ${BIO_MAX} caractères au plus.`;

  const ville = ligne(form.ville).slice(0, VILLE_MAX);
  const instaSaisi = texte(form.instagram);
  const insta = compteInsta(instaSaisi);
  if (instaSaisi && !insta) errors.instagram = "Ce compte n'a pas l'air juste : des lettres, des chiffres, des points et des _ seulement.";
  const profilSaisi = texte(form.profil);
  const profil = profilSaisi ? adresseWeb(profilSaisi) : null;
  if (profilSaisi && !profil) errors.profil = "Ce lien n'a pas l'air d'une adresse web.";
  const email = texte(form.email);
  if (email && (!EMAIL.test(email) || email.length > EMAIL_MAX)) errors.email = "Cette adresse e-mail n'a pas l'air complète.";
  if (!instaSaisi && !email) errors.contact = "Laisse ton Instagram ou ton e-mail, pour qu'on puisse te répondre.";

  if (Object.keys(errors).length) return { values: null, errors };
  return {
    values: {
      type: type as TypeCandidature,
      title: titre,
      pitch: description,
      styles,
      name: nom,
      bio,
      city: ville || null,
      instagram: insta || null,
      profileUrl: profil,
      email: email || null,
    },
    errors,
  };
}

/**
 * L'écran 3 : le son (`aSon` : un MP3 est arrivé, ou en route), ou, pour une playlist, son lien ; la tracklist, l'artiste
 * et le titre de chaque morceau (demandée sauf pour un podcast) ; le mot pour l'équipe, facultatif.
 */
export function lireEnvoi(form: CandidatureForm, { aSon }: { aSon: boolean }): { values: EnvoiValues | null; errors: CandidatureErrors } {
  const errors: CandidatureErrors = {};
  const type = texte(form.type);
  const lienSaisi = lienPossible(type) && !aSon ? texte(form.lien) : "";
  const lien = lienSaisi ? adresseWeb(lienSaisi) : null;
  if (lienSaisi && !lien) errors.lien = "Ce lien n'a pas l'air d'une adresse web.";
  else if (!aSon && !lien) errors.son = lienPossible(type) ? "Ajoute le MP3 de ta playlist, ou son lien." : "Ajoute le MP3 de ton émission.";
  const morceaux = lireMorceaux(typeof form.tracklist === "string" ? form.tracklist : "");
  const tracklist = ecrireMorceaux(morceaux);
  if (morceaux.some((morceau) => !morceau.artiste || !morceau.titre)) errors.tracklist = "Il manque l'artiste ou le titre d'un morceau : remplis les deux cases, ou retire la ligne.";
  else if (!morceaux.length && tracklistDemandee(type)) errors.tracklist = "Ajoute ta tracklist : l'artiste et le titre de chaque morceau.";
  else if (morceaux.length > MORCEAUX_MAX) errors.tracklist = `C'est beaucoup de morceaux : ${MORCEAUX_MAX} au plus.`;
  else if (morceaux.some((morceau) => morceau.artiste.length > MORCEAU_MAX || morceau.titre.length > MORCEAU_MAX))
    errors.tracklist = `Un artiste ou un titre est trop long (${MORCEAU_MAX} caractères au plus).`;
  else if (tracklist.length > TRACKLIST_MAX) errors.tracklist = `Cette tracklist est trop longue (${TRACKLIST_MAX} caractères au plus).`;
  const message = texte(form.message);
  if (message.length > MESSAGE_MAX) errors.message = `C'est un peu long : ${MESSAGE_MAX} caractères au plus.`;
  if (Object.keys(errors).length) return { values: null, errors };
  return { values: { listenUrl: lien, tracklist: tracklist || null, message: message || null }, errors };
}

/** Toute la candidature : les trois écrans. */
export function lireCandidature(form: CandidatureForm, { aSon }: { aSon: boolean }): { values: (DossierValues & EnvoiValues) | null; errors: CandidatureErrors } {
  const dossier = lireDossier(form);
  const envoi = lireEnvoi(form, { aSon });
  const errors = { ...dossier.errors, ...envoi.errors };
  if (!dossier.values || !envoi.values) return { values: null, errors };
  return { values: { ...dossier.values, ...envoi.values }, errors };
}
