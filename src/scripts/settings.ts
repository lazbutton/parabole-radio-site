// ============================ RÉGLAGES ============================
// Tout ce qu'on peut vouloir changer est ici. Ce fichier ne touche pas à la page : les pages Astro peuvent aussi le lire
// au build (le lien du formulaire sur À propos, par exemple).

// Mot de passe du staff : double-clic sur le logo de la barre du haut pour se connecter.
// NOTE : c'est une barrière côté navigateur. Elle écarte les curieux, mais n'importe qui peut la lire dans le code de la
// page : ce n'est PAS une sécurité. C'est acceptable ici, parce que le mode staff ne change que le navigateur de la
// personne connectée (localStorage), rien de partagé. Le futur CMS (/admin) le remplacera.
// ⬇️ À CHANGER avant la mise en ligne.
export const STAFF_PASSWORD = "PARABOLE2026";

// Le lien du bouton contributeurs, pour TOUS les visiteurs : la page Candidater du site (cms/README.md, 9.17), qui
// remplace le Google Form d'avant. Une page du site s'ouvre ici même, le direct continue ; une adresse d'ailleurs, dans
// un autre onglet. Le staff peut le changer pour son seul navigateur. "" : seulement le lien choisi par le staff.
export const DEFAULT_SUBTITLE_URL = "/candidater";

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
// Le chat. "antenne" : l'antenne libre (CHAT_EN_DIRECT.md) : les messages défilent dans le bandeau, on y écrit son pseudo
// puis son message, et la conversation se lit sur la page 888 (src/scripts/antenne.ts) ; la régie modère dans l'admin.
// "radiocult" : le chat de Radio Cult, dans le panneau CHAT (CHAT_URL), en secours. "" : pas de chat.
// Éteint depuis la navbar de la maquette (2 novembre 2026) : le bandeau du haut, où vivait l'antenne, a disparu, et elle
// n'a pas encore d'autre place à l'écran. Son code, sa base et la régie restent prêts : pour la rallumer, lui rendre une
// place (antenne.ts cherche .bandeau, .bandeau-piste et #antenneCase), puis remettre "antenne".
export const CHAT: "antenne" | "radiocult" | "" = "";
// Les phrases de Parabole, qui défilent dans la ligne ON AIR de l'accueil, séparées d'un carré jaune : ce qui passe y est
// déjà affiché en grand (src/scripts/nowplaying.ts). Ailleurs, la ligne fait défiler le titre.
export const PHRASES_ACCUEIL = ["PARABOLE RADIO", "UNION DE LA JEUNESSE INTERNATIONALE COMMUNITY RADIO", "CA VA PETER !!!", "LIVE", "PARIS 18"];
// Le chat de Radio Cult (CHAT = "radiocult"), aux couleurs du site (theme=custom : bc le fond, ptc le texte, stc et
// primaryColor les accents ; angles droits, layout=flat).
export const CHAT_URL =
  "https://app.radiocult.fm/embed/chat/parabole-radio-b02d5385?theme=custom&bc=%23000000&ptc=%23ffffff&stc=%23fff039&primaryColor=%23fff039&corners=sharp&layout=flat&hideAppLink=1";
// HISTORIQUE : un lien « Retrouver » sous chaque morceau que Hopper (hppr.fr) trouve mot pour mot sur les plateformes,
// comme sur OutLive. Demandé à notre route src/pages/api/hopper.ts, qui garde chaque réponse 30 jours. "" : aucun lien.
export const HOPPER_URL = "/api/hopper";
// Les vidéos de fond : la liste se tient dans l'admin (Vidéos de fond) et arrive par notre route src/pages/api/fond.ts.
// "" : seulement la liste de secours ci-dessous.
export const CLIPS_URL = "/api/fond";

// Les clips de fond se gèrent dans l'admin (Vidéos de fond) : ajouter, remplacer, retirer, renommer, ranger. La liste
// ci-dessous n'est que le secours, quand celle de l'admin ne répond pas (base injoignable) : les clips d'origine,
// livrés avec le site dans public/PARABOLE RADIO/VIDEO/BACKGROUND/. Ils passent au hasard (jamais deux fois le même
// de suite), avec de la neige entre deux, comme quand on zappe. Chaque clip est une chaîne : avec CHAINE_AU_ZAPPING,
// son numéro (sa place dans la liste) et son titre s'affichent quelques secondes à son arrivée ; sans titre, le numéro
// seul. À côté de chaque clip d'origine, une image .jpg du même nom (sa première image) s'affiche pendant qu'il charge.
// Afficher la chaîne (numéro et titre du clip) à chaque zapping : éteint pour le moment, la neige zappe seule.
export const CHAINE_AU_ZAPPING = false;
export const bgPlaylist: { src: string; titre?: string }[] = [
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background.mp4", titre: "Baile Furacão 2000" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background2.mp4", titre: "babyfather – killuminatti" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background3.mp4", titre: "Daft Punk 1996" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background4.mp4", titre: "Kiss FM Paris (INA)" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background5.mp4", titre: "logobi Black Panthers" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background6.mp4", titre: "Etran de L'Aïr – Imouha" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background7.mp4", titre: "Mafia K1 Fry – Pour ceux" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background8.mp4", titre: "Pirate Radio London / Rush FM" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background9.mp4", titre: "Wah Wah Watson + Herbie Hancock" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background10.mp4", titre: "Ça va péter" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background11.mp4", titre: "Nata Karim (série malienne)" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background12.mp4", titre: "Radio Cité Future / Radio Verte 1981 (INA)" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background13.mp4", titre: "Radio pirate mode d'emploi 1977 (INA)" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background14.mp4", titre: "Sankara / Zidane" },
  { src: "/PARABOLE RADIO/VIDEO/BACKGROUND/background15.mp4" }, // clip court, sans titre
];
// ========================== FIN DES RÉGLAGES ==========================
