// La coque, chargée une seule fois par onglet (src/layouts/Base.astro) : le même fichier sur toutes les pages, que le
// ClientRouter ne réexécute jamais. Chaque module se branche sur les éléments de la coque, qui ne sont jamais
// remplacés ; ce qui dépend de la page se refait après chaque navigation (router.ts).
import "./audio"; // AUDIO : le flux, la touche de lecture, le volume, l'analyse Web Audio
import "./background"; // la playlist des vidéos de fond
import "./panels"; // PROGRAMMATION, HISTORIQUE, CHAT, et les fenêtres
import "./nowplaying"; // NOW PLAYING : ce qui passe, le titre qui défile, l'affichage de l'accueil
import "./beat"; // BEAT : le pouls de la musique
import "./scope"; // SCOPE : l'oscilloscope du bandeau
import "./globe"; // GLOBE : le logo audioréactif
import "./contributors"; // le bouton contributeurs
import "./staff"; // le mode staff caché
import "./router"; // la navigation sans rechargement
import { pageChanged } from "./panels";

pageChanged();
