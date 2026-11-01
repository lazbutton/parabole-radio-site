// ---------- LA PLAYLIST DU FOND (liste de l'admin, Vidéos de fond) ----------
// La liste se tient dans l'admin et arrive par notre route (CLIPS_URL). Si elle tarde au chargement, le fond démarre
// sur la liste de secours de settings.ts et prend celle de l'admin dès qu'elle arrive. Un clip au hasard, puis un
// autre à la fin de chacun (jamais deux fois le même de suite). Un clic sur le fond lui-même (pas sur la barre du
// haut, le bandeau, un panneau, la feuille d'une rubrique ou un bouton) en lance un autre ; un clip mis par le staff
// (un fichier à lui) reste. Un clip qui ne se charge pas (retiré entre-temps, réseau) cède sa place au suivant. La
// vidéo est dans la coque : elle continue pendant la navigation.
import { bgPlaylist, CLIPS_URL } from "./settings";

type Clip = { src: string; titre?: string; poster?: string };

/** Ce qu'on attend la liste de l'admin avant de démarrer sur celle de secours. */
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

(async function initBgPlaylist() {
  const v = document.getElementById("backgroundVideo") as HTMLVideoElement | null;
  if (!v) return;
  const fromAdmin = fetchClips();
  let playlist: Clip[] = (await Promise.race([fromAdmin, new Promise<null>((resolve) => setTimeout(resolve, PATIENCE_MS, null))])) ?? bgPlaylist;
  // Arrivée en retard, la liste de l'admin vaut pour les clips suivants.
  fromAdmin.then((clips) => {
    if (clips) playlist = clips;
  });
  if (!playlist.length) return;
  let current = "";
  function pickRandom() {
    const others = playlist.filter((clip) => clip.src !== current);
    return (others.length ? others : playlist)[Math.floor(Math.random() * (others.length || playlist.length))];
  }
  function playRandom() {
    const clip = pickRandom();
    if (!clip) return;
    current = clip.src;
    v!.poster = posterOf(clip);
    v!.src = clip.src;
    v!.load();
    v!.play().catch(() => {});
  }
  playRandom(); // un clip au hasard pour commencer
  if (playlist.length < 2) return; // un seul clip : l'attribut loop le répète sans couture
  v.loop = false;
  v.addEventListener("ended", playRandom); // le suivant, au hasard (jamais le même)
  // Un clip illisible : un autre, mais pas en boucle si plus rien ne se charge.
  let failures = 0;
  v.addEventListener("playing", () => (failures = 0));
  v.addEventListener("error", () => {
    if (!v.currentSrc.startsWith("blob:") && ++failures < 4) playRandom();
  });
  document.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (
      e.button !== 0 ||
      target.closest?.("a, button, input, select, textarea, label, iframe, .popup, .float-item, .top-bar, .overlay-controls, .feuille")
    )
      return;
    if (v.currentSrc.startsWith("blob:")) return;
    playRandom();
  });
})();
