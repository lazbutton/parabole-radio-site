/**
 * L'antenne libre : les contrôles qui ne lisent que le texte (CHAT_EN_DIRECT.md, section 4.2). Sans base ni Node : le
 * serveur s'en sert pour décider, le navigateur pour prévenir tout de suite (@parabole/cms/antenne).
 */

/** Les sept couleurs du télétexte, pour les pseudos (le type énuméré chat_color de la base). */
export const COULEURS = ["red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
export type Couleur = (typeof COULEURS)[number];
export const estCouleur = (valeur: unknown): valeur is Couleur => COULEURS.includes(valeur as Couleur);

/** 160 caractères au plus, comme un SMS. */
export const LONGUEUR_MAX = 160;

/** Les plateformes de musique : les seuls liens permis, quand la régie les permet. */
export const LIENS_MUSIQUE = ["soundcloud.com", "bandcamp.com", "hppr.fr", "youtube.com", "youtu.be", "mixcloud.com"];

/** Personne ne se fait passer pour la station ni pour la régie. Les noms des artistes publiés s'y ajoutent (serveur). */
export const NOMS_RESERVES = ["parabole", "paraboleradio", "regie", "admin", "administrateur", "modo", "moderateur", "moderation", "equipe", "staff", "radio"];

const CHIFFRES: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Sans majuscules ni accents. */
export const sansAccents = (texte: string) => texte.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Le texte ramené à l'essentiel, pour comparer : sans majuscules ni accents, chiffres et symboles ramenés aux lettres
 * (« c0nn4rd »), lettres séparées recollées (« c.o.n », « c o n »), lettres répétées réduites (« boooon »).
 */
export function essentiel(texte: string): string {
  return sansAccents(texte)
    .replace(/[013457@$]/g, (c) => CHIFFRES[c] ?? c)
    .replace(/(?<![\p{L}\p{N}])\p{L}(?:[\s.\-_*]+\p{L}(?![\p{L}\p{N}])){2,}/gu, (suite) => suite.replace(/[^\p{L}]/gu, ""))
    .replace(/(\p{L})\1+/gu, "$1");
}

/**
 * La forme comparée d'un pseudo, unique dans la base : sans majuscules, accents ni séparateurs, les chiffres trompeurs
 * ramenés aux lettres (« Lune_N0ire » et « lunenoire » se valent). Les lettres répétées restent : « pseudo01 » et
 * « pseudo11 » sont deux pseudos.
 */
export const cleDePseudo = (pseudo: string) =>
  sansAccents(pseudo)
    .replace(/[013457@$]/g, (c) => CHIFFRES[c] ?? c)
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Le texte tel qu'il partira : caractères invisibles, de contrôle et d'inversion du sens d'écriture retirés, espaces resserrés. */
export function nettoyer(texte: string): string {
  return texte
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Le pseudo : 3 à 20 caractères, lettres (accents compris), chiffres, _ - et . ; une seule écriture. */
export function verifierFormePseudo(pseudo: string): string | null {
  if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(pseudo)) return "un pseudo, c'est 3 à 20 lettres, chiffres, _ - ou .";
  if (/\p{L}/u.test(pseudo) && !/^[\p{Script=Latin}\p{N}_.-]+$/u.test(pseudo)) return "ce pseudo n'est pas possible.";
  return null;
}

/** La forme d'un message (étape 5) : la raison d'un refus, ou null. */
export function verifierForme(texte: string): string | null {
  const longueur = [...texte].length;
  if (!longueur) return "le message est vide.";
  if (longueur > LONGUEUR_MAX) return `${LONGUEUR_MAX} caractères au plus.`;
  const lettres = texte.match(/\p{L}/gu) ?? [];
  const capitales = texte.match(/\p{Lu}/gu) ?? [];
  if (lettres.length > 15 && capitales.length / lettres.length > 0.7) return "trop de majuscules.";
  if ((texte.match(/\p{Extended_Pictographic}/gu) ?? []).length > 6) return "trop d'émojis.";
  if (/(.)\1{8,}/u.test(texte)) return "trop de lettres répétées.";
  if ((texte.match(/@[\p{L}\p{N}_.-]+/gu) ?? []).length > 3) return "trop de mentions.";
  return null;
}

const LIEN =
  /(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}-]+\s*(?:\.|\[\.\]|\(\.\)|\s(?:point|dot)\s)\s*(?:com|fr|net|org|io|ly|gg|me|tv|co|be|xyz|info|biz|link|app|to|page|site)\b\S*/giu;

/** Les liens d'un texte, même déguisés (« point com », [.], espaces). */
export const liensDe = (texte: string) => texte.match(LIEN) ?? [];

/** Une adresse vers une plateforme de musique ? */
export function lienPermis(adresse: string, permis: readonly string[] = LIENS_MUSIQUE): boolean {
  let hote = "";
  try {
    hote = new URL(/^https?:\/\//i.test(adresse) ? adresse : "https://" + adresse.replace(/\s+/g, "")).hostname.toLowerCase();
  } catch {
    return false;
  }
  return permis.some((domaine) => hote === domaine || hote.endsWith("." + domaine));
}

/** Les liens selon le réglage de la régie : la raison d'un refus, ou null. */
export function verifierLiens(texte: string, reglage: "none" | "music" | "all"): string | null {
  if (reglage === "all") return null;
  const liens = liensDe(texte);
  if (!liens.length) return null;
  if (reglage === "music" && liens.every((lien) => lienPermis(lien))) return null;
  return reglage === "music" ? "pas de liens à l'antenne, sauf vers les plateformes de musique." : "pas de liens à l'antenne.";
}

// Les numéros français (06 12 34 56 78, 0612345678, +33 6…) et les numéros internationaux écrits avec + ou 00 : pas
// une suite de chiffres quelconque, que des années (« 1997 2001 2005 ») suffiraient à faire passer pour un numéro.
const TELEPHONE = /(?:\+33|0033|\b0)\s?[1-9](?:[\s.-]?\d{2}){4}\b|(?:\+|\b00)\d{1,3}(?:[\s.-]?\d){7,12}\b/;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.\p{L}{2,}/u;

/** Un numéro de téléphone ou une adresse e-mail ? */
export const aDesCoordonnees = (texte: string) => TELEPHONE.test(texte) || EMAIL.test(texte);

/** Un mot de la liste de la régie. */
export type Terme = { term: string; action: "refuse" | "hold" | "mask"; anywhere: boolean };

/**
 * Ce que la liste de mots fait d'un texte (étape 8) : le pire de ce qu'elle y trouve (refuser, puis mettre en attente,
 * puis masquer), et le texte avec les mots masqués remplacés par « ••• ».
 */
export function appliquerListe(texte: string, termes: readonly Terme[]): { action: Terme["action"] | null; texte: string } {
  let pire: Terme["action"] | null = null;
  const rang = { refuse: 3, hold: 2, mask: 1 } as const;
  let masque = texte;
  const motsDuTexte = essentiel(texte).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const texteEntier = motsDuTexte.join("");
  for (const terme of termes) {
    const cherche = essentiel(terme.term).replace(/[^\p{L}\p{N}]/gu, "");
    if (!cherche) continue;
    const motsDuTerme = essentiel(terme.term).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const trouve = terme.anywhere
      ? texteEntier.includes(cherche)
      : motsDuTexte.some((_, i) => motsDuTerme.every((mot, j) => motsDuTexte[i + j] === mot));
    if (!trouve) continue;
    if (!pire || rang[terme.action] > rang[pire]) pire = terme.action;
    if (terme.action === "mask") masque = masquer(masque, terme.term);
  }
  return { action: pire, texte: masque };
}

/** Remplace, dans le texte d'origine, les mots qui ramenés à l'essentiel donnent ce terme. */
function masquer(texte: string, terme: string): string {
  const cible = essentiel(terme).replace(/[^\p{L}\p{N}]/gu, "");
  return texte.replace(/[\p{L}\p{N}@$]+/gu, (mot) => (essentiel(mot) === cible ? "•••" : mot));
}
