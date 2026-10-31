// ============================ RÉGLAGES ============================
// Tout ce qu'on peut vouloir changer est ici. Ce fichier ne touche pas à la page : les pages Astro peuvent aussi le lire
// au build (le lien du formulaire sur À propos, par exemple).

// Mot de passe du staff : double-clic sur le logo de la barre du haut pour se connecter.
// NOTE : c'est une barrière côté navigateur. Elle écarte les curieux, mais n'importe qui peut la lire dans le code de la
// page : ce n'est PAS une sécurité. C'est acceptable ici, parce que le mode staff ne change que le navigateur de la
// personne connectée (localStorage), rien de partagé. Le futur CMS (/admin) le remplacera.
// ⬇️ À CHANGER avant la mise en ligne.
export const STAFF_PASSWORD = "PARABOLE2026";

// Le lien du formulaire contributeurs, pour TOUS les visiteurs (le staff peut le changer pour son seul navigateur).
// "" : seulement le lien choisi par le staff.
export const DEFAULT_SUBTITLE_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSdd0G1tn5WbVDM4stWcq4IiSMGGaEQ2Ldpd83fDWgAR0H1TPQ/viewform?usp=dialog";

// Les textes qui se relaient sur le bouton jaune des contributeurs (un toutes les 1,5 s).
export const phrases = [
  "RECHERCHE DE CONTRIBUTEURS RADIO",
  "LOOKING FOR RADIO CONTRIBUTORS",
  "DJ'S",
  "PODCASTS",
  "GENRES SPECIALISTS",
  "MUSIC ENTHUSIASTS",
  "PARABOLE RADIO COMING SOON",
  "CA VA PETER !!",
  "CLIQUER ICI",
];

// La station passe par notre propre API (src/pages/api/), qui lit Radio Cult aujourd'hui et lira BUTTON (Radiocompas)
// demain : seul son adaptateur changera (src/lib/station). Elle répond toujours au format Radiocompas.
//   NOWPLAYING_URL .. ce qui passe ; SCHEDULE_URL .. la programmation ; HISTORY_URL .. les derniers morceaux
// Le flux vient aussi de l'adaptateur : il est écrit dans la page au build (data-flux sur #player).
// Une adresse "" éteint sa partie : le lecteur dit « OFF AIR », les panneaux annoncent la suite.
export const NOWPLAYING_URL = "/api/direct";
export const SCHEDULE_URL = "/api/programme";
export const HISTORY_URL = "/api/historique";
export const STATION_TIMEZONE = "Europe/Paris"; // les panneaux donnent les heures de la station
// Le chat (panneau CHAT) : l'intégration de Radio Cult, aux couleurs du site (theme=custom : bc le fond, ptc le texte,
// stc et primaryColor les accents ; angles droits, layout=flat). "" le cache.
export const CHAT_URL =
  "https://app.radiocult.fm/embed/chat/parabole-radio-b02d5385?theme=custom&bc=%23000000&ptc=%23ffffff&stc=%23fff039&primaryColor=%23fff039&corners=sharp&layout=flat&hideAppLink=1";
// HISTORIQUE : un lien « Retrouver » sous chaque morceau que Hopper (hppr.fr) trouve mot pour mot sur les plateformes,
// comme sur OutLive. Demandé à notre route src/pages/api/hopper.ts, qui garde chaque réponse 30 jours. "" : aucun lien.
export const HOPPER_URL = "/api/hopper";

// Les clips de fond. UN clip : il boucle sans couture (rien à faire).
// Pour en faire tourner plusieurs : déposer les vidéos dans le MÊME dossier
//   public/PARABOLE RADIO/VIDEO/BACKGROUND/
// et ajouter chaque chemin ci-dessous. Ils passent au hasard (jamais deux fois le même de suite).
// À côté de chaque clip, une image .jpg du même nom (sa première image) s'affiche pendant qu'il charge :
//   ffmpeg -i background16.mp4 -frames:v 1 -q:v 4 background16.jpg
export const bgPlaylist = [
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background.mp4", // Baile Furacão 2000
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background2.mp4", // babyfather – killuminatti
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background3.mp4", // Daft Punk 1996
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background4.mp4", // Kiss FM Paris (INA)
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background5.mp4", // logobi Black Panthers
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background6.mp4", // Etran de L'Aïr – Imouha
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background7.mp4", // Mafia K1 Fry – Pour ceux
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background8.mp4", // Pirate Radio London / Rush FM
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background9.mp4", // Wah Wah Watson + Herbie Hancock
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background10.mp4", // Ça va péter
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background11.mp4", // Nata Karim (série malienne)
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background12.mp4", // Radio Cité Future / Radio Verte 1981 (INA)
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background13.mp4", // Radio pirate mode d'emploi 1977 (INA)
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background14.mp4", // Sankara / Zidane
  "/PARABOLE RADIO/VIDEO/BACKGROUND/background15.mp4", // clip court
];
// ========================== FIN DES RÉGLAGES ==========================
