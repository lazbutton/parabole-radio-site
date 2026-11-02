// ---------- L'ANTENNE LIBRE : CE QUI LA RELIE À SA SOURCE ----------
// L'antenne (antenne.ts) affiche ; la source (antenne-supabase.ts) dit ce qui passe et transmet ce qu'on envoie à notre
// serveur, qui décide (CHAT_EN_DIRECT.md, sections 4 et 6).

/** Les sept couleurs du télétexte, pour les pseudos (chat_color dans la base) ; le bleu, éclairci, reste lisible sur le noir. */
export const COULEURS = {
  red: "#ff4848",
  green: "#3dff6e",
  yellow: "#fff039",
  blue: "#8090ff",
  magenta: "#ff5cf0",
  cyan: "#3df2ff",
  white: "#ffffff",
} as const;
export type Couleur = keyof typeof COULEURS;

export type Message = {
  id: string;
  pseudo: string;
  couleur: Couleur;
  texte: string;
  /** Un message de la régie : la case PARABOLE à la place du pseudo. */
  regie?: boolean;
  /** L'envoi, en millisecondes. */
  heure: number;
  /** Le passage à l'antenne : l'envoi, plus le différé. Avant, personne ne le voit, sauf son auteur. */
  antenne: number;
};

/**
 * L'antenne telle que la régie la règle (le différé et le mode lent en secondes, les messages au bandeau ou non) ;
 * signal : la connexion.
 */
export type Etat = { ouvert: boolean; differe: number; lent: number; bandeau: boolean; signal: boolean };

/** Un refus de code « pseudo » vise le pseudo, pas le message : on le corrige avant de renvoyer. */
export type Reponse = { issue: "antenne" | "attente"; message: Message } | { issue: "refuse"; raison: string; code?: "pseudo" };

/** Ce que la source annonce à l'antenne. */
export type Ecoute = {
  message(m: Message): void;
  /** Brouillé par la régie : il ne passe plus, ou ne passera jamais s'il était en différé. */
  retrait(id: string): void;
  /** La régie remet l'antenne à zéro. */
  vidage(): void;
  etat(e: Etat): void;
  /** Un message en attente que la régie n'a pas passé. */
  rejet(id: string, raison: string): void;
};

export type Source = {
  demarrer(ecoute: Ecoute): void;
  /** Le pseudo (nouveau ou changé), puis le message : le serveur décide. */
  envoyer(envoi: { pseudo: string; couleur: Couleur; texte: string }): Promise<Reponse>;
  /** Signaler un message à la régie : la raison d'un refus, ou null. */
  signaler(id: string): Promise<string | null>;
  /** La forme du pseudo est-elle bonne ? La raison d'un refus, ou null. Le serveur, lui, revérifie tout à l'envoi. */
  verifierPseudo(pseudo: string): string | null;
};

/** La forme comparée d'un pseudo ou d'un mot : sans majuscules ni accents. */
export const cle = (texte: string) => texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Les seuls domaines qu'un lien peut viser ; la page 888 les rend cliquables, le bandeau jamais. */
export const LIENS_PERMIS = ["soundcloud.com", "bandcamp.com", "hppr.fr", "youtube.com", "youtu.be", "mixcloud.com"];

/** Une adresse vers un domaine permis ? */
export function lienPermis(adresse: string): boolean {
  let hote = "";
  try {
    hote = new URL(/^https?:\/\//i.test(adresse) ? adresse : "https://" + adresse).hostname;
  } catch {
    return false;
  }
  return LIENS_PERMIS.some((domaine) => hote === domaine || hote.endsWith("." + domaine));
}
