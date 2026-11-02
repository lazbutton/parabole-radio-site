// La coque, chargée une seule fois par onglet (src/layouts/Base.astro) : le même fichier sur toutes les pages, que le
// ClientRouter ne réexécute jamais. Chaque module se branche sur les éléments de la coque, qui ne sont jamais
// remplacés ; ce qui dépend de la page se refait après chaque navigation (router.ts).
import "./audio"; // AUDIO : le flux, la touche de lecture, le volume, l'analyse Web Audio
import "./background"; // la playlist des vidéos de fond
import "./panels"; // PROGRAMMATION, HISTORIQUE, CHAT, et les fenêtres
import "./antenne"; // l'antenne libre : le chat, sur la page 888 (éteint pour l'instant : CHAT dans settings.ts)
import "./nowplaying"; // NOW PLAYING : ce qui passe, dans la ligne ON AIR et sur l'accueil
import "./teletexte"; // l'heure des pages de télétexte de l'en-tête
import "./juste-avant"; // JUSTE AVANT : le morceau d'avant, dans la ligne ON AIR
import "./recherche"; // la loupe : chercher dans tout le site
import "./sommaire"; // le sommaire en télétexte, le menu des téléphones
import "./residents"; // la grille des résidents : filtres sur place, index A–Z, à l'antenne
import "./artiste"; // la page d'un artiste : bio, prochaine émission, rangées, zapping
import "./beat"; // BEAT : le pouls de la musique
import "./globe"; // GLOBE : le logo audioréactif
import "./contributors"; // le bouton contributeurs
import "./staff"; // le mode staff caché
import "./router"; // la navigation sans rechargement
import { pageChanged } from "./panels";

pageChanged();
