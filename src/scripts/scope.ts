// ---------- SCOPE : l'écran du lecteur ----------
// Dessiné comme un vrai oscilloscope : un graticule et ses graduations, des indications et des repères de déclenchement,
// et un faisceau de phosphore, plus pâle là où il va vite et qui s'éteint lentement derrière lui. En lecture, la trace
// est déclenchée : calée sur un front montant au quart de l'écran, elle tient en place là et change plus loin. Là où le
// son peut être analysé (voir audio.ts), ce sont les basses du vrai son, et le faisceau s'illumine sur chaque beat ;
// ailleurs, une simulation de musique. À l'arrêt, une petite porteuse passe, non déclenchée ; en connexion, du bruit ;
// hors antenne, une mire. Dans le bandeau (une bande, « compact »), il n'a ni écran, ni graticule, ni indications :
// seulement le faisceau, avec un bord sombre, et une ligne plate hors antenne. Là, il est aussi la progression du
// morceau : ce qui a joué est plat, ce qui reste bouge encore.
// Environ 30 images par seconde, et rien du tout hors antenne ou hors de vue (ou masqué).
import { radioControl } from "./audio";
import { station } from "./state";

(function playerScope() {
  const canvas = document.getElementById("playerScope") as HTMLCanvasElement | null;
  const player = document.getElementById("player");
  if (!canvas || !player || !canvas.getContext) return;
  const ctx = canvas.getContext("2d")!;
  const grid = document.createElement("canvas"),
    gridCtx = grid.getContext("2d")!; // le graticule, dessiné une fois par taille
  const glow = document.createElement("canvas"),
    glowCtx = glow.getContext("2d")!; // le phosphore, où les traces s'éteignent
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const YELLOW = "#fff039",
    BLUE = "#000dff",
    READOUT = "rgba(255,255,255,0.75)";
  let w = 1,
    h = 1,
    divX = 1,
    divY = 1,
    trigX = 0,
    trigLevel = 0,
    vignette: CanvasGradient | null = null,
    compact = false;
  let t = 0,
    vpp = 0,
    running = false,
    last = 0;
  let vPerDiv = 0.5,
    msPerDiv = 5; // ce qu'affichent les indications
  let peakTrack = 0,
    pulse = 0; // le vrai son : son amplitude, et l'éclat d'un beat (BEAT)
  // la musique : une note grave et deux harmoniques, un son médium désaccordé (pour que l'onde change loin du point de
  // déclenchement) et un souffle ; son niveau saute comme des temps forts, sa note change de temps en temps
  const music = { level: 0.4, target: 0.8, period: 3.2, phase: [0, 1, 2, 3] };
  player.addEventListener("beat", () => {
    pulse = 1;
  });
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, canvas!.clientWidth);
    h = Math.max(1, canvas!.clientHeight);
    (
      [
        [canvas!, ctx],
        [grid, gridCtx],
        [glow, glowCtx],
      ] as const
    ).forEach(([c, g]) => {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    divY = h / 4; // 4 divisions de haut,
    divX = w / (2 * Math.max(1, Math.round(w / (2 * divY)))); // un nombre pair en largeur, à peu près carrées
    trigX = Math.round(w / 4);
    trigLevel = divY * 0.15;
    compact = h < 48; // une bande : pas de place pour les indications
    vignette = ctx.createRadialGradient(w / 2, h / 2, h / 2, w / 2, h / 2, w / 1.6); // le verre bombé du tube
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.45)");
    drawGrid();
  }
  // le graticule : des divisions en pointillés, et les axes centraux gradués tous les cinquièmes de division
  function drawGrid() {
    const g = gridCtx,
      cx = Math.round(w / 2),
      cy = Math.round(h / 2);
    g.clearRect(0, 0, w, h);
    g.fillStyle = BLUE;
    g.globalAlpha = 0.8;
    for (let x = divX; x < w - 1; x += divX) for (let y = 0; y < h; y += divY / 5) g.fillRect(Math.round(x), Math.round(y), 1, 1);
    for (let y = divY; y < h - 1; y += divY) for (let x = 0; x < w; x += divX / 5) g.fillRect(Math.round(x), Math.round(y), 1, 1);
    g.globalAlpha = 1;
    g.fillRect(0, cy, w, 1);
    g.fillRect(cx, 0, 1, h);
    for (let x = divX / 5; x < w; x += divX / 5) g.fillRect(Math.round(x), cy - 2, 1, 5);
    for (let y = divY / 5; y < h; y += divY / 5) g.fillRect(cx - 2, Math.round(y), 5, 1);
  }
  function testCard() {
    const bars = ["#fff039", "#ffffff", "#000dff", "#000000", "#fff039", "#000dff", "#ffffff"];
    const bw = w / bars.length,
      top = Math.round(h * 0.68);
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw), top);
    });
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, top, w, h - top);
    ctx.fillStyle = "#fff039";
    ctx.font = '700 9px "Monument Grotesk", sans-serif';
    ctx.textBaseline = "middle";
    ctx.fillText("PAS DE SIGNAL", 6, (top + h) / 2);
  }
  const sweep = (fn: (x: number) => number) => Array.from({ length: Math.ceil(w) + 1 }, (_, x) => fn(x)); // un point par pixel, vers le haut depuis la ligne du milieu
  function nextMusic() {
    const m = music;
    if (Math.random() < 0.12) m.target = 0.5 + Math.random() * 0.45; // le niveau saute, comme des temps forts
    if (Math.random() < 0.012) m.period = [2.4, 2.8, 3.2, 3.6, 4.2][Math.floor(Math.random() * 5)]; // une nouvelle note
    m.level += (m.target - m.level) * 0.25;
    m.phase = m.phase.map((p, i) => p + [0.9, 0.05, 0.08, 0.6][i] * Math.random()); // le son avance entre deux balayages
  }
  // En lecture : une acquisition, alignée comme le fait un oscilloscope, sur le premier front montant qui passe le niveau
  // de déclenchement après le point de déclenchement.
  function triggered() {
    const m = music,
      k = (2 * Math.PI) / (m.period * divX),
      amp = m.level * divY;
    const at = (x: number) =>
      amp *
      (0.9 * Math.sin(k * x + m.phase[0]) +
        0.35 * Math.sin(2 * k * x + m.phase[1]) +
        0.2 * Math.sin(3 * k * x + m.phase[2]) +
        0.3 * Math.sin(5.37 * k * x + m.phase[3]));
    let shift = 0;
    for (let x = trigX + 1; x < trigX + 2 * m.period * divX; x++)
      if (at(x - 1) < trigLevel && at(x) >= trigLevel) {
        shift = x - trigX;
        break;
      }
    return sweep((x) => at(x + shift) + (Math.random() - 0.5) * 1.2);
  }
  // En lecture avec l'analyse : les basses du vrai son à 2 ms par division, déclenchées sur leur dernier front montant
  // qui tient dans l'écran. Les volts par division suivent leur niveau par pas de 1-2-5, comme l'« autoset » d'un
  // oscilloscope.
  const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
  function measured({ data, rate }: { data: Float32Array; rate: number }) {
    const n = data.length,
      spp = Math.min((rate * 0.002) / divX, (n * 0.7) / w),
      span = Math.ceil(w * spp),
      pre = Math.round(trigX * spp);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
    peakTrack = Math.max(peak, peakTrack * 0.995);
    vPerDiv = STEPS.find((s) => peakTrack / s <= 2.5) || 1; // les plus fortes crêtes peuvent sortir de l'écran
    const level = Math.max(0.004, peak * 0.15);
    let at = -1;
    for (let i = n - span + pre; i > pre; i--)
      if (data[i - 1] < level && data[i] >= level) {
        at = i;
        break;
      }
    const start = at < 0 ? n - span : at - pre,
      scale = divY / vPerDiv;
    const ys = sweep((x) => {
      // chaque pixel : la moyenne de ses échantillons
      let s = 0,
        k = 0;
      for (let i = Math.floor(start + x * spp); i < start + (x + 1) * spp && i < n; i++, k++) s += data[i];
      return k ? Math.max(-h / 2, Math.min(h / 2, (s / k) * scale)) : 0;
    });
    return { ys, triggered: at >= 0 };
  }
  const carrier = () => sweep((x) => divY * 0.3 * Math.sin((Math.PI * x) / divX - t * 0.12) + (Math.random() - 0.5) * 0.8);
  function noise() {
    let v = 0;
    return sweep(() => (v = 0.82 * (v + (Math.random() - 0.5) * divY * 0.5)));
  }
  // Le phosphore s'éteint un peu à chaque image, puis prend la nouvelle trace.
  function fade(keep: number) {
    glowCtx.globalCompositeOperation = "destination-out";
    glowCtx.fillStyle = `rgba(0,0,0,${1 - keep})`;
    glowCtx.fillRect(0, 0, w, h);
    glowCtx.globalCompositeOperation = "source-over";
  }
  // Le faisceau : plus brillant là où il va lentement, comme sur un tube cathodique. Les segments sont rangés par pente
  // dans quatre tracés, de pleine luminosité à un quart. Sur un beat, il s'illumine.
  function beam(ys: number[]) {
    const g = glowCtx,
      cy = h / 2,
      paths: number[][] = [[], [], [], []];
    for (let x = 1; x < ys.length; x++) paths[Math.min(3, Math.floor(Math.abs(ys[x] - ys[x - 1]) / 2))].push(x);
    g.globalCompositeOperation = "lighter";
    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = YELLOW;
    // le halo autour, d'un seul trait pour qu'il ne s'accumule pas là où les segments se rejoignent
    g.beginPath();
    ys.forEach((y, x) => (x ? g.lineTo(x, cy - y) : g.moveTo(0, cy - y)));
    g.globalAlpha = 0.1 + 0.25 * pulse;
    g.lineWidth = 4 + 3 * pulse;
    g.stroke();
    paths.forEach((xs, i) => {
      // le faisceau
      if (!xs.length) return;
      g.beginPath();
      xs.forEach((x) => {
        g.moveTo(x - 1, cy - ys[x - 1]);
        g.lineTo(x, cy - ys[x]);
      });
      g.globalAlpha = [1, 0.6, 0.38, 0.24][i];
      g.lineWidth = 1.25 + 0.75 * pulse;
      g.stroke();
    });
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  // Ce qu'un oscilloscope écrit sur son écran : les volts et le temps par division de la voie 1, la crête à crête
  // mesurée, l'état du déclenchement (blanc sur un beat). Repères : le point de déclenchement (en haut), son niveau (à
  // droite), le zéro (à gauche).
  function overlay(status: string) {
    if (compact) return;
    const cy = h / 2,
      ly = cy - trigLevel;
    ctx.fillStyle = YELLOW;
    [
      [trigX - 3, 0, trigX + 3, 0, trigX, 4],
      [w, ly - 3, w, ly + 3, w - 4, ly],
      [0, cy - 3, 0, cy + 3, 4, cy],
    ].forEach((p) => {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.lineTo(p[4], p[5]);
      ctx.fill();
    });
    ctx.fillRect(3, 3, 9, 9); // le badge de la voie 1
    ctx.font = '700 7px "Monument Grotesk", sans-serif';
    ctx.textBaseline = "middle";
    const text = (s: string, x: number, y: number, align: CanvasTextAlign, color: string) => {
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(s, x, y);
    };
    text("1", 7.5, 7.5, "center", "#000000");
    text(vPerDiv < 1 ? Math.round(vPerDiv * 1000) + "mV" : vPerDiv + "V", 15, 7.5, "left", READOUT);
    text(msPerDiv.toFixed(2) + "ms", w - 4, 7.5, "right", READOUT);
    text("Vpp " + vpp.toFixed(2) + "V", 4, h - 7, "left", READOUT);
    text(status, w - 4, h - 7, "right", pulse > 0.4 ? "#ffffff" : YELLOW);
    ctx.textAlign = "left";
  }
  function draw() {
    if (!canvas!.clientWidth) return; // masqué (petits écrans) : rien à dessiner
    const state = player!.dataset.state;
    ctx.clearRect(0, 0, w, h);
    if (state === "off") {
      glowCtx.clearRect(0, 0, w, h);
      if (compact) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(0, Math.round(h / 2), w, 1);
      } else testCard();
      return;
    }
    let ys: number[], status: string, sound: ReturnType<NonNullable<typeof radioControl>["signal"]> = null;
    vPerDiv = 0.5;
    msPerDiv = 5;
    if (state === "playing" && !still && (sound = radioControl && radioControl.signal())) {
      const m = measured(sound);
      ys = m.ys;
      status = m.triggered ? "TRIG’D" : "AUTO";
      msPerDiv = 2;
    } else if (state === "playing") {
      nextMusic();
      ys = triggered();
      status = "TRIG’D";
    } else if (state === "loading" || state === "error") {
      ys = noise();
      status = still || (t >> 3) % 2 ? "TRIG?" : "";
    } else {
      ys = carrier();
      status = "AUTO";
    }
    // la progression : ce qui a joué est plat, ce qui reste bouge encore (une pente de 6 px entre les deux)
    const edge = station.progress == null ? null : station.progress * w;
    if (edge != null) ys = ys.map((y, x) => (x < edge - 6 ? 0 : x < edge ? (y * (x - edge + 6)) / 6 : y));
    if (still) glowCtx.clearRect(0, 0, w, h);
    else fade(state === "playing" ? 0.72 : 0.55);
    beam(ys);
    if (still || t % 6 === 0) vpp = ((Math.max(...ys) - Math.min(...ys)) / divY) * vPerDiv;
    if (compact) {
      // un bord sombre sous le faisceau, pour qu'il se lise sur la vidéo
      ctx.beginPath();
      ys.forEach((y, x) => (x ? ctx.lineTo(x, h / 2 - y) : ctx.moveTo(0, h / 2 - y)));
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 4;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.stroke();
    } else ctx.drawImage(grid, 0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glow, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    if (!compact && vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }
    overlay(status);
    pulse *= 0.8;
    t++;
  }
  function loop(now: number) {
    const off = player!.dataset.state === "off";
    if (off || now - last >= 33) {
      last = now;
      draw();
    } // hors antenne : la mire, puis la boucle s'arrête
    if (off) {
      running = false;
      return;
    }
    requestAnimationFrame(loop);
  }
  function wake() {
    if (still) {
      draw();
      return;
    }
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
  }
  size();
  draw();
  new MutationObserver(wake).observe(player, { attributes: true, attributeFilter: ["data-state"] });
  window.addEventListener("resize", () => {
    size();
    draw();
  });
  document.fonts && document.fonts.ready.then(draw); // les indications et la mire en Monument Grotesk
  wake();
})();
