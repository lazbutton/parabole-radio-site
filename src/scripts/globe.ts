// ---------- GLOBE : le logo animé, en haut à gauche ----------
// Un WebP animé de 100 images à 10 par seconde. Sur ordinateur, ses images sont décodées une fois (avec ImageDecoder, à
// partir de l'image déjà chargée, une fois la page posée) et dessinées sur un canevas posé dessus, chaque
// rafraîchissement fondant deux images voisines : il tourne en douceur. Sa vitesse glisse d'une valeur à l'autre : la
// sienne (10 images par seconde) radio arrêtée ; pendant l'écoute avec le son analysé (voir audio.ts), le niveau des
// basses la règle (BEAT), lent dans les passages calmes, plus vite quand c'est fort, et chaque beat lui donne un élan et
// une brève pulsation. Ailleurs, ou avec « réduire les animations », l'image tourne d'elle-même comme avant.
// Le globe est dans la coque : décodé une fois, il tourne sans interruption d'une page à l'autre.
import { station } from "./state";

(function smoothGlobe() {
  const img = document.getElementById("logoOverlay") as HTMLImageElement | null;
  const player = document.getElementById("player");
  if (!img || !player || !("ImageDecoder" in window) || !window.matchMedia) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return; // téléphones : la mémoire
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "logo-overlay";
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  (img.closest("picture") || img).after(canvas);
  const ctx = canvas.getContext("2d")!;
  let frames: ImageBitmap[] = [],
    at = 0,
    last = 0,
    speed = 10,
    swell = 0;
  async function decode(): Promise<ImageBitmap[]> {
    const answer = await fetch(img!.currentSrc || img!.src);
    const type = (answer.headers.get("content-type") || "").split(";")[0];
    if (!type || !(await ImageDecoder.isTypeSupported(type)) || !answer.body) return [];
    const decoder = new ImageDecoder({ data: answer.body, type });
    await decoder.completed;
    const count = decoder.tracks.selectedTrack!.frameCount,
      out: ImageBitmap[] = [];
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      out.push(await createImageBitmap(image));
      image.close();
    }
    decoder.close();
    return out.length > 1 ? out : [];
  }
  // sa propre vitesse (10 images par seconde), ou avec la musique celle du niveau des basses (BEAT) : lent quand c'est
  // calme, rapide quand c'est fort
  const target = () => (station.level === null ? 10 : 4 + 18 * station.level * station.level);
  function loop(now: number) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    swell *= Math.pow(0.0005, dt); // la pulsation d'un beat s'éteint en 0,15 s environ
    speed += (target() - speed) * (1 - Math.pow(0.02, dt)); // glisse vers la nouvelle vitesse (et revient d'un élan)
    at = (at + speed * dt) % frames.length;
    const i = Math.floor(at),
      next = (i + 1) % frames.length;
    const scale = 1 + 0.07 * swell,
      w = canvas.width,
      h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, (w * (1 - scale)) / 2, (h * (1 - scale)) / 2); // gonflé depuis son centre
    ctx.globalAlpha = 1;
    ctx.drawImage(frames[i], 0, 0);
    ctx.globalAlpha = at - i; // l'image suivante, en fondu
    ctx.drawImage(frames[next], 0, 0);
    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  player.addEventListener("beat", () => {
    speed += 16;
    swell = 1;
  }); // chaque beat : un élan, une pulsation
  const begin = () =>
    decode()
      .then((f) => {
        if (!f.length) return;
        frames = f;
        canvas.width = f[0].width;
        canvas.height = f[0].height;
        canvas.hidden = false;
        img.style.visibility = "hidden";
        requestAnimationFrame(loop);
      })
      .catch(() => {});
  if (document.readyState === "complete") setTimeout(begin, 500);
  else window.addEventListener("load", () => setTimeout(begin, 500), { once: true });
})();
