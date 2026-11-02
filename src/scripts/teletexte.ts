// ---------- L'HEURE DES PAGES DE TÉLÉTEXTE de l'en-tête (la loupe, JUSTE AVANT, le sommaire) ----------
// Comme sur un téléviseur : l'heure de la station à la seconde, en haut à droite de chaque page ouverte ([data-horloge]).
import { STATION_TIMEZONE } from "./settings";

const heure = new Intl.DateTimeFormat("en-GB", { timeZone: STATION_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function tic() {
  const maintenant = heure.format(new Date());
  // seulement les pages ouvertes : une horloge cachée n'a pas besoin d'être à l'heure
  document.querySelectorAll<HTMLElement>("[data-horloge]").forEach((el) => {
    if (el.offsetParent !== null && el.textContent !== maintenant) el.textContent = maintenant;
  });
}
/** Met les horloges à l'heure tout de suite (à l'ouverture d'une page), sans attendre la seconde suivante. */
export const mettreALHeure = tic;
setInterval(tic, 1000);
