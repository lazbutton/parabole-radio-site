/**
 * Le format « Radiocompas » : celui que la page lit, et que notre API sert (/api/direct, /api/programme,
 * /api/historique). Radiocompas, la console de BUTTON, le donne tel quel ; les réponses de Radio Cult y sont
 * traduites par son adaptateur (radiocult.ts).
 */

/** Un morceau, dans le direct ou l'historique. */
export interface Track {
  title: string;
  artist: string;
  album?: string;
  /** Heure de début (ISO 8601), dans l'historique. */
  played_at?: string;
}

/** Ce qui passe à l'antenne (now.json chez Radiocompas). */
export interface NowPlaying {
  /** Le morceau ; vide quand on ne sait pas ce qui passe. */
  title: string;
  artist: string;
  album: string;
  /** Radio Cult seulement : le nom de l'émission à l'antenne, vide sinon. */
  show: string;
  /** autodj : musique en continu ; show : émission enregistrée ; live : direct ; relay : relais ; off : hors antenne. */
  source: "autodj" | "show" | "live" | "relay" | "off";
  /** Durée du morceau en secondes, 0 si inconnue. */
  duration: number;
  /** Secondes déjà jouées à `received_at`. */
  elapsed: number;
  remaining?: number;
  /** Instant de référence de `elapsed` (ISO 8601). Radio Cult donne le début du morceau, avec `elapsed` à 0. */
  received_at: string | null;
  /** Radiocompas seulement : le morceau d'avant et le prochain de la musique en continu. */
  previous?: Track;
  next_autodj?: Track;
}

/** Une émission de la programmation. */
export interface ScheduleItem {
  starts_at: string;
  ends_at: string;
  title: string;
  /** emission : émission de la grille ; set : mix enregistré ; direct : en direct. */
  kind: "emission" | "set" | "direct";
  /** Les noms des artistes du créneau, quand la station les donne. */
  artists?: string[];
}

/** La programmation des 7 prochains jours (depuis la veille, pour les heures déjà passées d'aujourd'hui). */
export interface Schedule {
  timezone: string;
  items: ScheduleItem[];
}

/** Les derniers morceaux diffusés, du plus récent au plus ancien. */
export interface History {
  items: Track[];
}
