// ---------- BEAT : le pouls de la musique, pour l'oscilloscope, le panneau ON AIR et le globe ----------
// Pendant que la radio joue avec le son analysé (voir audio.ts), à chaque image : l'énergie de la grosse caisse (sous
// 150 Hz, les 20 dernières ms) face à sa dernière seconde. Un beat est un saut nettement au-dessus de l'habitude (la
// moyenne plus un écart et demi, et un tiers au-dessus de la moyenne), en montée, au plus un toutes les 180 ms : il part
// en événement « beat » sur #player. station.level est le niveau des basses, de 0 à 1 face à leur plus fort récent
// (null tant que rien n'est analysé).
import { radioControl } from "./audio";
import { station } from "./state";

(function beat() {
  const player = document.getElementById("player");
  if (!player || !radioControl) return;
  const control = radioControl;
  const recent: number[] = [];
  let running = false,
    lastBeat = 0,
    previous = 0,
    loudest = 1e-6;
  function frame(now: number) {
    const sound = player!.dataset.state === "playing" && control.signal();
    if (!sound) {
      running = false;
      station.level = null;
      recent.length = 0;
      return;
    }
    let sum = 0;
    for (const v of sound.kick) sum += v * v;
    const energy = sum / sound.kick.length;
    recent.push(energy);
    if (recent.length > 60) recent.shift();
    const mean = recent.reduce((t, e) => t + e, 0) / recent.length;
    const deviation = Math.sqrt(recent.reduce((t, e) => t + (e - mean) * (e - mean), 0) / recent.length);
    if (
      recent.length > 20 &&
      energy > mean + 1.5 * deviation &&
      energy > mean * 1.3 &&
      energy > previous &&
      energy > 1e-5 &&
      now - lastBeat > 180
    ) {
      lastBeat = now;
      player!.dispatchEvent(new Event("beat"));
    }
    previous = energy;
    loudest = Math.max(energy, loudest * 0.997);
    station.level = Math.sqrt(energy / loudest);
    requestAnimationFrame(frame);
  }
  new MutationObserver(() => {
    if (!running && player.dataset.state === "playing" && control.signal()) {
      running = true;
      requestAnimationFrame(frame);
    }
  }).observe(player, { attributes: true, attributeFilter: ["data-state"] });
})();
