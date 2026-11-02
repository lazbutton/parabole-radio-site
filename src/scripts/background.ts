// ---------- LA PLAYLIST DU FOND (liste de l'admin, Vidéos de fond), ET LE ZAPPING ----------
// La liste se tient dans l'admin et arrive par notre route (CLIPS_URL). Le fond l'attend 1,5 s au plus pendant
// l'allumage, démarre sinon sur la liste de secours de settings.ts, et prend celle de l'admin dès qu'elle arrive. Un
// clip au hasard, puis un autre à la fin de chacun (jamais deux fois le même de suite). Un clic sur le fond lui-même
// (pas sur l'en-tête, la ligne du bas, un panneau, la feuille d'une rubrique ou un bouton) en lance un autre ; un clip
// mis par le staff (un fichier à lui) reste. Entre deux clips, on zappe : la neige tombe (neige.ts), le numéro de la
// chaîne et le titre du clip s'affichent (si CHAINE_AU_ZAPPING, settings.ts), et l'image revient en roulant dès que le
// clip joue. Un clip illisible (retiré entre-temps, réseau) cède sa place au suivant. Au chargement de l'onglet, le
// premier clip arrive ainsi, après l'allumage du téléviseur (html.allumage, tele.css). Avec « réduire les
// animations », ni neige ni roulis : le clip change. La vidéo est dans la coque : elle continue pendant la navigation.
import { neige } from "./neige";
import { bgPlaylist, CHAINE_AU_ZAPPING, CLIPS_URL } from "./settings";

type Clip = { src: string; titre?: string; poster?: string };

/** Ce qu'on attend la liste de l'admin avant de démarrer sur celle de secours : l'écran reste en neige jusque-là. */
const PATIENCE_MS = 1500;

/** La liste de l'admin, ou null si elle ne répond pas. */
async function fetchClips(): Promise<Clip[] | null> {
  if (!CLIPS_URL) return null;
  try {
    const response = await fetch(CLIPS_URL, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const { clips } = (await response.json()) as { clips?: unknown };
    return Array.isArray(clips) ? clips.filter((clip): clip is Clip => typeof clip?.src === "string" && Boolean(clip.src)) : null;
  } catch {
    return null;
  }
}

/** L'image d'attente : celle que donne la liste, sinon le .jpg posé à côté d'un clip d'origine. */
const posterOf = (clip: Clip) => clip.poster ?? (/\.mp4$/.test(clip.src) ? clip.src.replace(/\.mp4$/, ".jpg") : "");

/** Le fond montre-t-il la photo d'un artiste (le mode photo, plus bas) ? Les clips se font alors discrets. */
let enPhoto = false;
/** On écoute le son des vidéos (RADIO / VIDÉO sur VIDÉO, audio.ts) : la vidéo continue, même cachée. */
const sonDesVideos = () => document.getElementById("soundToggle")?.dataset.mode === "video";

(async function initBgPlaylist() {
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  const root = document.documentElement;
  const still = !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = performance.now();
  const fromAdmin = v ? fetchClips() : Promise.resolve(null);
  let playlist: Clip[] = (await Promise.race([fromAdmin, new Promise<null>((resolve) => setTimeout(resolve, PATIENCE_MS, null))])) ?? bgPlaylist;
  // Arrivée en retard, la liste de l'admin vaut pour les clips suivants.
  fromAdmin.then((clips) => {
    if (clips) playlist = clips;
  });
  if (!v || !playlist.length) {
    neige.eteindre();
    root.classList.remove("allumage");
    return;
  }
  const osd = document.getElementById("osd"),
    osdNumber = document.getElementById("osdNumero"),
    osdTitle = document.getElementById("osdTitre");
  let current = "", // le clip qui passe (son adresse) : le suivant en est un autre, même si la liste a changé
    zap = 0, // le zapping en cours : un nouveau prend la main sur l'ancien
    failures = 0, // les clips illisibles de suite
    osdTimer: ReturnType<typeof setTimeout> | undefined;
  function pickRandom() {
    let n: number;
    do {
      n = Math.floor(Math.random() * playlist.length);
    } while (playlist[n].src === current && playlist.length > 1);
    return n;
  }
  // la chaîne, comme sur un téléviseur : son numéro (sa place dans la liste) et son titre, quelques secondes
  function showChannel(n: number) {
    if (!CHAINE_AU_ZAPPING || !osd || !osdNumber || !osdTitle) return;
    clearTimeout(osdTimer);
    osdNumber.textContent = String(n + 1).padStart(2, "0");
    osdTitle.textContent = playlist[n].titre || "";
    osd.classList.add("visible");
  }
  const hideChannel = (after: number) => {
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osd?.classList.remove("visible"), after);
  };
  /**
   * Le clip n, après la neige : au moins `minimum` ms de neige, et l'image dès que le clip joue (4 s au plus). La
   * promesse se tient aussi quand un autre zapping prend la main (sa neige reste alors).
   */
  function tune(n: number, minimum: number) {
    const id = ++zap,
      clip = playlist[n],
      from = performance.now();
    current = clip.src;
    // derrière la photo d'un artiste, le clip change sans neige ni numéro, et ne joue que si on écoute son son
    if (!enPhoto) showChannel(n);
    if (!still && !enPhoto) neige.allumer();
    v!.poster = posterOf(clip);
    v!.src = clip.src;
    v!.autoplay = !enPhoto || sonDesVideos(); // sinon l'attribut autoplay la relancerait au chargement
    v!.load();
    if (v!.autoplay) v!.play().catch(() => {});
    return new Promise<void>((resolve) => {
      const ready = () => {
        v!.removeEventListener("playing", ready);
        v!.removeEventListener("error", ready);
        clearTimeout(timer);
        setTimeout(() => {
          if (id === zap && !enPhoto) {
            neige.eteindre();
            // l'image revient en roulant, un peu trop claire, comme un poste qui accroche la chaîne
            if (!still)
              v!.animate(
                [
                  { transform: "translateY(-9%) scaleY(1.04)", filter: "brightness(2.2) contrast(1.25)" },
                  { transform: "translateY(2.5%)", filter: "brightness(1.4)", offset: 0.45 },
                  { transform: "translateY(-0.8%)", offset: 0.7 },
                  { transform: "none", filter: "none" },
                ],
                { duration: 460, easing: "cubic-bezier(0.25, 0.9, 0.35, 1)" },
              );
            hideChannel(2800);
          }
          resolve();
        }, Math.max(0, minimum - (performance.now() - from)));
      };
      v!.addEventListener("playing", ready);
      v!.addEventListener("error", ready);
      const timer = setTimeout(ready, 4000);
    });
  }
  // zapper : l'image se tord une fraction de seconde, puis la neige et la chaîne suivante
  function zapTo(n: number) {
    if (!still) v!.animate([{ filter: "none" }, { transform: "scaleY(0.94) translateY(2%)", filter: "brightness(2.6)" }], { duration: 70 });
    return tune(n, 420 + Math.random() * 280);
  }

  // l'allumage : le premier clip, après au moins 1,2 s de neige depuis le chargement (l'attente de la liste comprise) ;
  // html.allumage s'en va quand tout est posé
  if (still) neige.eteindre();
  tune(pickRandom(), Math.max(0, 1200 - (performance.now() - start))).then(() =>
    setTimeout(() => root.classList.remove("allumage"), Math.max(0, 4200 - performance.now())),
  );
  if (playlist.length < 2) return; // un seul clip : l'attribut loop le répète sans couture
  v.loop = false;
  v.addEventListener("ended", () => zapTo(pickRandom())); // le suivant, au hasard (jamais le même)
  // Un clip illisible : un autre, mais pas en boucle si plus rien ne se charge.
  v.addEventListener("playing", () => (failures = 0));
  v.addEventListener("error", () => {
    if (!v.currentSrc.startsWith("blob:") && ++failures < 4) zapTo(pickRandom());
  });
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (
      enPhoto || // la photo d'un artiste ne se zappe pas
      e.button !== 0 ||
      target.closest?.("a, button, input, select, textarea, label, iframe, .popup, .float-item, .tete, .overlay-controls, .feuille, .direct")
    )
      return;
    if (v.currentSrc.startsWith("blob:")) return;
    zapTo(pickRandom());
  });
})();

// ---------- LE MODE PHOTO : la page d'un artiste prend l'antenne ----------
// Une page qui porte data-fond-photo (la page d'un artiste, src/pages/residents/[slug].astro) remplace la vidéo par sa
// photo, comme on change de chaîne : la neige tombe, la photo arrive (entière, la même floutée autour ; sans photo, la
// mire, Background.astro et socle.css), puis la neige s'en va. La vidéo se met en pause, sauf si on écoute son son. En
// quittant la page, la neige, puis la vidéo reprend. Avec « réduire les animations », sans neige. Regardé au chargement,
// puis après chaque navigation.
type Photo = { src?: string; srcset?: string | null; flou?: string; mire?: boolean };
let photoMontree = "",
  demandePhoto = 0;
const calmePhoto = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function mettreLaPhoto(photo: Photo) {
  const fond = document.getElementById("fondPhoto");
  if (!fond) return;
  const cle = photo.mire || !photo.src ? "mire" : photo.src;
  if (enPhoto && cle === photoMontree) return;
  const id = ++demandePhoto;
  const still = calmePhoto();
  if (!still) neige.allumer();
  const nette = fond.querySelector<HTMLImageElement>(".fond-photo-nette")!;
  const flou = fond.querySelector<HTMLImageElement>(".fond-photo-flou")!;
  if (cle !== "mire") {
    if (photo.srcset) {
      nette.srcset = photo.srcset;
      nette.sizes = "100vw";
    } else nette.removeAttribute("srcset");
    nette.src = cle;
    flou.src = photo.flou || cle;
    // la photo arrive quand elle est prête (1,5 s au plus) : la neige couvre l'attente
    await Promise.race([nette.decode().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
    if (id !== demandePhoto) return;
  }
  fond.classList.toggle("mire", cle === "mire");
  enPhoto = true;
  photoMontree = cle;
  document.documentElement.classList.add("fond-en-photo");
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  if (v && !sonDesVideos()) {
    v.autoplay = false;
    v.pause();
  }
  setTimeout(() => id === demandePhoto && neige.eteindre(), still ? 0 : 260);
}

function retirerLaPhoto() {
  if (!enPhoto) return;
  const id = ++demandePhoto;
  const still = calmePhoto();
  enPhoto = false;
  photoMontree = "";
  if (!still) neige.allumer();
  document.documentElement.classList.remove("fond-en-photo");
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  if (v) {
    v.autoplay = true;
    v.play().catch(() => {});
  }
  setTimeout(() => id === demandePhoto && neige.eteindre(), still ? 0 : 320);
}

function regarderLaPage() {
  const source = document.querySelector<HTMLElement>("[data-fond-photo]");
  if (!source) return retirerLaPhoto();
  let photo: Photo = { mire: true };
  try {
    photo = JSON.parse(source.dataset.fondPhoto || "{}");
  } catch (e) {
    /* la mire */
  }
  mettreLaPhoto(photo);
}
document.addEventListener("astro:after-swap", regarderLaPage);
regarderLaPage();
