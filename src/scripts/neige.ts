// ---------- LA NEIGE : le bruit d'un téléviseur entre deux chaînes (le zapping, background.ts) ----------
// D'après « CRT TV Effect » de Karl Saunders (https://codepen.io/Mobius1/pen/zZpoXj) : un canevas en basse résolution
// (un point pour trois pixels d'écran), agrandi à la taille de l'écran. Ici, trois écrans de bruit sont tirés une fois
// (chaque point bave un peu sur son voisin, comme le balayage d'un vieux tube) ; chaque image en montre une tranche au
// hasard, avec une bande sombre qui descend lentement et quelques lignes plus claires. Environ 30 images par seconde,
// et rien du tout quand elle est éteinte. Le canevas est allumé dans la page (Background.astro), pour l'allumage.

const canvas = document.getElementById("neige") as HTMLCanvasElement | null;
const ctx = canvas?.getContext("2d", { alpha: false }) ?? null;
let pool: HTMLCanvasElement | null = null; // trois hauteurs d'écran de bruit
let w = 0,
  h = 0,
  raf = 0,
  last = 0,
  band = 0,
  on = false,
  stop: ReturnType<typeof setTimeout> | undefined;

function size() {
  const W = Math.max(64, Math.min(480, Math.ceil(innerWidth / 3)));
  const H = Math.max(36, Math.ceil((W * innerHeight) / Math.max(1, innerWidth)));
  if (pool && W === w && H === h) return;
  w = canvas!.width = W;
  h = canvas!.height = H;
  pool = document.createElement("canvas");
  pool.width = w;
  pool.height = h * 3;
  const p = pool.getContext("2d")!;
  const img = p.createImageData(w, h * 3);
  const px = new Uint32Array(img.data.buffer);
  let prev = 0;
  for (let i = 0; i < px.length; i++) {
    const v = Math.min(255, (Math.random() * 180 + prev * 0.3) | 0); // la bavure : un peu du point d'avant
    prev = v;
    px[i] = 0xff000000 | (v << 16) | (v << 8) | v; // un gris opaque
  }
  p.putImageData(img, 0, 0);
}

function draw(now: number) {
  raf = requestAnimationFrame(draw);
  if (now - last < 33) return;
  last = now;
  ctx!.drawImage(pool!, 0, Math.floor(Math.random() * h * 2), w, h, 0, 0, w, h);
  // la bande sombre qui descend, comme sur un vieux poste mal réglé
  band = (band + h * 0.02) % (h * 1.6);
  const top = band - h * 0.3,
    shade = ctx!.createLinearGradient(0, top, 0, top + h * 0.6);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.5, "rgba(0,0,0,0.38)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx!.fillStyle = shade;
  ctx!.fillRect(0, top, w, h * 0.6);
  // quelques lignes plus claires
  ctx!.fillStyle = "rgba(255,255,255,0.2)";
  for (let i = 0; i < 3; i++) ctx!.fillRect(0, Math.floor(Math.random() * h), w, 1);
}

window.addEventListener("resize", () => {
  if (on) size();
});

export const neige = {
  /** Elle tombe d'un coup sur l'image. */
  allumer() {
    if (!canvas || !ctx) return;
    clearTimeout(stop);
    on = true;
    size();
    canvas.classList.add("visible");
    if (!raf) raf = requestAnimationFrame(draw);
  },
  /** Elle s'efface en un éclair ; le dessin s'arrête une fois le fondu fini. */
  eteindre() {
    if (!canvas) return;
    on = false;
    canvas.classList.remove("visible");
    clearTimeout(stop);
    stop = setTimeout(() => {
      if (on) return;
      cancelAnimationFrame(raf);
      raf = 0;
    }, 200);
  },
};
